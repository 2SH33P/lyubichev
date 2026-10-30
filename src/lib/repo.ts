import type { AppDB } from './db';
import { Hlc } from './hlc';
import { decide } from './merge';
import { sameContent } from './normalize';
import type { AnyRecord, DataSet, HistoryItem, RecordMap, TableName } from './types';
import { TABLES } from './types';

export interface MergeResult {
  taken: number;
  conflicts: number;
  changed: Set<TableName>;
}

/**
 * 数据写入层：所有修改都经过这里，负责打时间戳、写历史、登记待同步队列。
 */
export class Repo {
  constructor(
    public db: AppDB,
    public deviceId: string,
    public hlc: Hlc
  ) {}

  static async open(db: AppDB, deviceId: string) {
    const state = await db.getKv<{ ms: number; counter: number } | undefined>('hlc', undefined);
    return new Repo(db, deviceId, new Hlc(deviceId, state));
  }

  private stamp<T extends AnyRecord>(r: T, now: number): T {
    return { ...r, hlc: this.hlc.tick(), updatedAt: now, deviceId: this.deviceId };
  }

  private async persistClock() {
    await this.db.setKv('hlc', this.hlc.state);
  }

  /** 新建或更新若干记录 */
  async put<K extends TableName>(
    table: K,
    records: RecordMap[K][],
    reason: HistoryItem['reason'] = 'edit'
  ): Promise<RecordMap[K][]> {
    const now = Date.now();
    const t = this.db.table_(table);
    const saved: RecordMap[K][] = [];
    await this.db.transaction('rw', [t, this.db.history, this.db.outbox, this.db.kv], async () => {
      for (const r of records) {
        const prev = (await t.get(r.id)) as RecordMap[K] | undefined;
        if (prev && !prev.deleted && sameContent(prev, r)) {
          saved.push(prev);
          continue;
        }
        if (prev && !prev.deleted) await this.db.history.add({ table, recordId: r.id, at: now, reason, data: prev });
        const rec = this.stamp({ ...r, createdAt: prev?.createdAt ?? r.createdAt ?? now } as RecordMap[K], now);
        if (!rec.deleted) delete rec.deleted;
        await t.put(rec);
        await this.db.outbox.put({ key: `${table}:${r.id}`, table, id: r.id });
        saved.push(rec);
      }
      await this.persistClock();
    });
    return saved;
  }

  /** 删除（写入墓碑，便于同步删除） */
  async remove(table: TableName, ids: string[], reason: HistoryItem['reason'] = 'delete') {
    const now = Date.now();
    const t = this.db.table_(table);
    await this.db.transaction('rw', [t, this.db.history, this.db.outbox, this.db.kv], async () => {
      for (const id of ids) {
        const prev = (await t.get(id)) as AnyRecord | undefined;
        if (!prev || prev.deleted) continue;
        await this.db.history.add({ table, recordId: id, at: now, reason, data: prev });
        await t.put(this.stamp({ ...prev, deleted: true } as AnyRecord, now));
        await this.db.outbox.put({ key: `${table}:${id}`, table, id });
      }
      await this.persistClock();
    });
  }

  /** 合并远端记录（来自同步），按混合逻辑时钟决定取舍 */
  async applyRemote(data: Partial<DataSet>): Promise<MergeResult> {
    const result: MergeResult = { taken: 0, conflicts: 0, changed: new Set() };
    const now = Date.now();
    const tables = TABLES.filter((t) => data[t]?.length);
    if (!tables.length) return result;
    const stores = tables.map((t) => this.db.table_(t));
    await this.db.transaction('rw', [...stores, this.db.history, this.db.outbox, this.db.kv], async () => {
      for (const table of tables) {
        const t = this.db.table_(table);
        const list = data[table] as AnyRecord[];
        const ids = list.map((r) => r.id);
        const existing = (await t.bulkGet(ids)) as (AnyRecord | undefined)[];
        const toPut: AnyRecord[] = [];
        for (let i = 0; i < list.length; i++) {
          const remote = list[i];
          const local = existing[i];
          this.hlc.receive(remote.hlc);
          if (decide(local, remote) !== 'take') continue;
          if (local && !local.deleted) {
            const dirty = await this.db.outbox.get(`${table}:${local.id}`);
            const isConflict = !!dirty && !sameContent(local, remote);
            if (isConflict) result.conflicts++;
            if (!sameContent(local, remote)) {
              await this.db.history.add({
                table,
                recordId: local.id,
                at: now,
                reason: isConflict ? 'conflict' : 'edit',
                data: local
              });
            }
          }
          toPut.push(remote);
        }
        if (toPut.length) {
          await t.bulkPut(toPut);
          result.taken += toPut.length;
          result.changed.add(table);
        }
      }
      await this.persistClock();
    });
    return result;
  }

  /**
   * 用一套数据整体替换当前数据（恢复版本 / 覆盖导入）。
   * 不在目标里的记录写墓碑；内容变化的记录重新打时间戳，从而在多端同步中胜出。
   */
  async replaceAll(target: DataSet, reason: HistoryItem['reason'] = 'restore') {
    for (const table of TABLES) {
      const t = this.db.table_(table);
      const current = ((await t.toArray()) as AnyRecord[]).filter((r) => !r.deleted);
      const targetIds = new Set(target[table].map((r) => r.id));
      const removeIds = current.filter((r) => !targetIds.has(r.id)).map((r) => r.id);
      if (removeIds.length) await this.remove(table, removeIds, reason);
      if (target[table].length) await this.put(table, target[table].map((r) => ({ ...r, deleted: undefined })) as any, reason);
    }
  }

  async readAll(includeDeleted = false): Promise<DataSet> {
    const out = {} as DataSet;
    for (const t of TABLES) {
      const rows = (await this.db.table_(t).toArray()) as AnyRecord[];
      (out as any)[t] = includeDeleted ? rows : rows.filter((r) => !r.deleted);
    }
    return out;
  }

  async historyOf(table: TableName, recordId: string): Promise<HistoryItem[]> {
    const rows = await this.db.history.where('[table+recordId]').equals([table, recordId]).toArray();
    return rows.sort((a, b) => b.at - a.at);
  }

  async pruneHistory(maxAgeDays = 180) {
    const cutoff = Date.now() - maxAgeDays * 86_400_000;
    await this.db.history.where('at').below(cutoff).delete();
  }
}
