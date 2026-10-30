import { gunzipJson, gzipJson } from './codec';
import { uuid } from './ids';
import { migrateBackup } from './migrations';
import type { Repo } from './repo';
import { netMs, dayKey, MIN, DAY } from './time';
import { SCHEMA_VERSION, TABLES, type BackupFile, type DataSet, type VersionKind, type VersionMeta, type VersionRow, type VersionSummary } from './types';

export function summarize(data: DataSet): VersionSummary {
  const counts = Object.fromEntries(TABLES.map((t) => [t, data[t].length])) as VersionSummary['counts'];
  let total = 0;
  let first: number | null = null;
  let last: number | null = null;
  for (const e of data.entries) {
    total += netMs(e, e.end ?? e.start);
    first = first === null ? e.start : Math.min(first, e.start);
    last = last === null ? e.start : Math.max(last, e.start);
  }
  return { counts, totalMinutes: Math.round(total / MIN), firstEntry: first, lastEntry: last };
}

export function makeBackup(data: DataSet, deviceId: string): BackupFile {
  return { app: 'lyubishchev-time', schemaVersion: SCHEMA_VERSION, exportedAt: Date.now(), deviceId, data };
}

export async function createVersion(repo: Repo, kind: VersionKind, name: string | null = null): Promise<VersionMeta> {
  const data = await repo.readAll(false);
  const blob = gzipJson(makeBackup(data, repo.deviceId));
  const row: VersionRow = { id: uuid(), createdAt: Date.now(), kind, name, deviceId: repo.deviceId, summary: summarize(data), size: blob.length, blob };
  await repo.db.versions.put(row);
  await pruneVersions(repo);
  const { blob: _b, ...meta } = row;
  return meta;
}

export async function listVersions(repo: Repo): Promise<VersionMeta[]> {
  const rows = await repo.db.versions.orderBy('createdAt').reverse().toArray();
  return rows.map(({ blob: _b, ...m }) => m);
}

export async function loadVersion(repo: Repo, id: string): Promise<BackupFile> {
  const row = await repo.db.versions.get(id);
  if (!row) throw new Error('version not found');
  return migrateBackup(gunzipJson(row.blob)).backup;
}

/** 恢复版本：先保存当前状态，再整体替换（会通过同步传播到其他设备） */
export async function restoreBackup(repo: Repo, backup: BackupFile) {
  await createVersion(repo, 'pre-restore');
  await repo.replaceAll(backup.data, 'restore');
}

export async function deleteVersion(repo: Repo, id: string) {
  await repo.db.versions.delete(id);
}

export async function renameVersion(repo: Repo, id: string, name: string | null) {
  await repo.db.versions.update(id, { name, kind: 'manual' });
}

/** 每天首次打开时自动保存一个版本 */
export async function ensureDailyVersion(repo: Repo) {
  const today = dayKey(Date.now());
  const last = await repo.db.versions.where('kind').equals('daily').reverse().sortBy('createdAt');
  if (last[0] && dayKey(last[0].createdAt) === today) return null;
  const data = await repo.readAll(false);
  if (!data.entries.length && !data.todos.length) return null;
  return createVersion(repo, 'daily');
}

/**
 * 保留策略：手动版本永久保留；自动版本 7 天内全部保留，
 * 12 周内每周保留最新一个，更早的每月保留最新一个。
 */
export function selectPrunable(rows: Pick<VersionMeta, 'id' | 'createdAt' | 'kind'>[], now = Date.now()): string[] {
  const auto = rows.filter((r) => r.kind !== 'manual').sort((a, b) => b.createdAt - a.createdAt);
  const keepBuckets = new Set<string>();
  const remove: string[] = [];
  for (const r of auto) {
    const age = now - r.createdAt;
    if (age < 7 * DAY) continue;
    const d = new Date(r.createdAt);
    const bucket = age < 84 * DAY ? `w${Math.floor((r.createdAt - 4 * DAY) / (7 * DAY))}` : `m${d.getFullYear()}-${d.getMonth()}`;
    if (keepBuckets.has(bucket)) remove.push(r.id);
    else keepBuckets.add(bucket);
  }
  return remove;
}

export async function pruneVersions(repo: Repo) {
  const rows = await listVersions(repo);
  const ids = selectPrunable(rows);
  if (ids.length) await repo.db.versions.bulkDelete(ids);
}
