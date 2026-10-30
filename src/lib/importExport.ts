import { decryptJson, encryptJson, type EncryptedEnvelope } from './codec';
import { migrateBackup } from './migrations';
import { sameContent } from './normalize';
import type { Repo } from './repo';
import { TABLES, type AnyRecord, type BackupFile, type TableName } from './types';
import { createVersion, makeBackup } from './versions';

export type ImportMode = 'merge' | 'overwrite';

export class EncryptedFileError extends Error {
  constructor() {
    super('encrypted');
  }
}

export async function exportBackupJson(repo: Repo, password?: string): Promise<string> {
  const backup = makeBackup(await repo.readAll(false), repo.deviceId);
  if (password) return JSON.stringify(await encryptJson(backup, password));
  return JSON.stringify(backup);
}

export async function parseBackupText(text: string, password?: string): Promise<{ backup: BackupFile; invalid: number }> {
  let raw = JSON.parse(text.replace(/^\uFEFF/, ''));
  if (raw?.format === 'encrypted') {
    if (!password) throw new EncryptedFileError();
    raw = await decryptJson(raw as EncryptedEnvelope, password);
  }
  return migrateBackup(raw);
}

export interface ImportPreview {
  tables: Record<TableName, { add: number; update: number; skip: number; remove: number }>;
}

export async function previewImport(repo: Repo, backup: BackupFile, mode: ImportMode): Promise<ImportPreview> {
  const tables = {} as ImportPreview['tables'];
  for (const t of TABLES) {
    const local = new Map(((await repo.db.table_(t).toArray()) as AnyRecord[]).filter((r) => !r.deleted).map((r) => [r.id, r]));
    const s = { add: 0, update: 0, skip: 0, remove: 0 };
    const incomingIds = new Set<string>();
    for (const r of backup.data[t] as AnyRecord[]) {
      incomingIds.add(r.id);
      const l = local.get(r.id);
      if (!l) s.add++;
      else if (sameContent(l, r)) s.skip++;
      else if (mode === 'overwrite' || r.updatedAt > l.updatedAt) s.update++;
      else s.skip++;
    }
    if (mode === 'overwrite') for (const id of local.keys()) if (!incomingIds.has(id)) s.remove++;
    tables[t] = s;
  }
  return { tables };
}

export async function applyImport(repo: Repo, backup: BackupFile, mode: ImportMode) {
  await createVersion(repo, 'pre-import');
  if (mode === 'overwrite') {
    await repo.replaceAll(backup.data, 'import');
    return;
  }
  for (const t of TABLES) {
    const local = new Map(((await repo.db.table_(t).toArray()) as AnyRecord[]).map((r) => [r.id, r]));
    const toPut = (backup.data[t] as AnyRecord[]).filter((r) => {
      if (r.deleted) return false;
      const l = local.get(r.id);
      return !l || l.deleted || (!sameContent(l, r) && r.updatedAt > l.updatedAt);
    });
    if (toPut.length) await repo.put(t, toPut as any, 'import');
  }
}

export function download(filename: string, content: string | Uint8Array, mime = 'application/json') {
  const blob = new Blob([content as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
