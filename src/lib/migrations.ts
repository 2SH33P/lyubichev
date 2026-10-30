import { normalizeDataSet } from './normalize';
import { SCHEMA_VERSION, type BackupFile } from './types';

export class NewerSchemaError extends Error {
  constructor(public version: number) {
    super(`schema ${version} is newer than supported ${SCHEMA_VERSION}`);
  }
}
export class InvalidBackupError extends Error {}

/**
 * 每个迁移把 v 版本数据转换为 v+1。新增字段时在这里追加，例如：
 *   2: (d) => { d.entries.forEach(e => e.mood ??= null); return d; }
 */
const MIGRATIONS: Record<number, (data: any) => any> = {};

export function migrateBackup(raw: any): { backup: BackupFile; invalid: number } {
  if (!raw || raw.app !== 'lyubishchev-time' || typeof raw.data !== 'object') throw new InvalidBackupError('not a backup file');
  let v = Number(raw.schemaVersion) || 1;
  if (v > SCHEMA_VERSION) throw new NewerSchemaError(v);
  let data = raw.data;
  while (v < SCHEMA_VERSION) {
    const m = MIGRATIONS[v + 1];
    if (m) data = m(data);
    v++;
  }
  const { data: norm, invalid } = normalizeDataSet(data);
  return {
    backup: { app: 'lyubishchev-time', schemaVersion: SCHEMA_VERSION, exportedAt: Number(raw.exportedAt) || Date.now(), deviceId: String(raw.deviceId || ''), data: norm },
    invalid
  };
}
