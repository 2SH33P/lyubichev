import {
  decryptBytes,
  deriveKey,
  encryptBytes,
  fromB64,
  gunzipJson,
  gzipJson,
  KDF_ITERATIONS,
  randomBytes,
  toB64
} from '../codec';
import { randomId } from '../ids';
import type { Repo } from '../repo';
import type { DataSet, TableName, VersionMeta } from '../types';
import { TABLES } from '../types';
import { listAll, type ObjectStorage } from './storage';
import { strFromU8, strToU8 } from 'fflate';

export interface RemoteMeta {
  app: 'lyubishchev-time';
  format: 1;
  epoch: string;
  encrypted: boolean;
  kdf?: { salt: string; iterations: number };
  check?: string;
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
}

export interface SyncState {
  epoch: string | null;
  cursors: Record<string, string>;
  snapshotKey: string | null;
  uncovered: number;
  lastSync: number | null;
  needFullPush: boolean;
}

export const emptyState = (): SyncState => ({ epoch: null, cursors: {}, snapshotKey: null, uncovered: 0, lastSync: null, needFullPush: false });

export interface KeyStore {
  get(epoch: string): Promise<CryptoKey | null>;
  set(epoch: string, key: CryptoKey | null): Promise<void>;
}

export interface StateStore {
  load(): Promise<SyncState>;
  save(s: SyncState): Promise<void>;
}

export interface SyncReport {
  pulledFiles: number;
  pulledRecords: number;
  pushedRecords: number;
  conflicts: number;
  snapshotApplied: boolean;
  compacted: boolean;
  changed: TableName[];
}

export class NeedPasswordError extends Error {
  constructor() {
    super('need-password');
  }
}
export class WrongPasswordError extends Error {
  constructor() {
    super('wrong-password');
  }
}
export class NotInitializedError extends Error {
  constructor() {
    super('not-initialized');
  }
}

const CHECK_TEXT = 'lyubishchev-ok';
const GRACE_MS = 7 * 86_400_000;
const KEEP_SNAPSHOTS = 3;

interface ChangeFile {
  deviceId: string;
  createdAt: number;
  data: Partial<DataSet>;
}
interface SnapshotFile {
  deviceId: string;
  createdAt: number;
  covers: Record<string, string>;
  data: DataSet;
}

const b64url = (b: Uint8Array) => toB64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s: string) => fromB64(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));

/** 从对象键中提取时间部分（用于宽限期判断） */
const keyTime = (key: string) => Number(key.split('/').pop()!.slice(0, 13)) || 0;

export interface EngineOptions {
  repo: Repo;
  storage: ObjectStorage;
  prefix: string;
  keys: KeyStore;
  state: StateStore;
  compactThreshold?: number;
  now?: () => number;
}

/**
 * 多端同步引擎。云端布局：
 *   {prefix}/meta.json
 *   {prefix}/e{epoch}/changes/{deviceId}/{hlc}.bin     每次推送的增量（只新增，不覆盖）
 *   {prefix}/e{epoch}/snapshots/{hlc}_{deviceId}.bin   压缩后的全量快照
 *   {prefix}/e{epoch}/versions/{createdAt}_{meta}.bin  手动上传的命名版本
 */
export class SyncEngine {
  repo: Repo;
  storage: ObjectStorage;
  prefix: string;
  keys: KeyStore;
  stateStore: StateStore;
  threshold: number;
  now: () => number;

  constructor(o: EngineOptions) {
    this.repo = o.repo;
    this.storage = o.storage;
    this.prefix = o.prefix.replace(/^\/+|\/+$/g, '');
    this.keys = o.keys;
    this.stateStore = o.state;
    this.threshold = o.compactThreshold ?? 50;
    this.now = o.now ?? Date.now;
  }

  get deviceId() {
    return this.repo.deviceId;
  }

  private k(...parts: string[]) {
    return [this.prefix, ...parts].filter(Boolean).join('/');
  }
  private ep(epoch: string, ...parts: string[]) {
    return this.k(`e${epoch}`, ...parts);
  }

  // ---------- meta 与密钥 ----------

  async getMeta(): Promise<RemoteMeta | null> {
    const raw = await this.storage.get(this.k('meta.json'));
    if (!raw) return null;
    return JSON.parse(strFromU8(raw)) as RemoteMeta;
  }

  private async putMeta(meta: RemoteMeta) {
    await this.storage.put(this.k('meta.json'), strToU8(JSON.stringify(meta, null, 2)), 'application/json');
  }

  private async keyFor(meta: RemoteMeta): Promise<CryptoKey | null> {
    if (!meta.encrypted) return null;
    const key = await this.keys.get(meta.epoch);
    if (!key) throw new NeedPasswordError();
    return key;
  }

  /** 用密码解锁已加密的云端数据 */
  async unlock(password: string, meta?: RemoteMeta): Promise<void> {
    meta = meta ?? (await this.getMeta()) ?? undefined;
    if (!meta) throw new NotInitializedError();
    if (!meta.encrypted || !meta.kdf) return;
    const key = await deriveKey(password, fromB64(meta.kdf.salt), meta.kdf.iterations);
    try {
      const plain = strFromU8(await decryptBytes(key, fromB64(meta.check!)));
      if (plain !== CHECK_TEXT) throw new Error();
    } catch {
      throw new WrongPasswordError();
    }
    await this.keys.set(meta.epoch, key);
  }

  private async newMeta(encrypt: boolean, password?: string): Promise<{ meta: RemoteMeta; key: CryptoKey | null }> {
    const epoch = `${this.now().toString(36)}${randomId(4)}`;
    const now = this.now();
    const meta: RemoteMeta = { app: 'lyubishchev-time', format: 1, epoch, encrypted: encrypt, createdAt: now, updatedAt: now, updatedBy: this.deviceId };
    let key: CryptoKey | null = null;
    if (encrypt) {
      if (!password) throw new NeedPasswordError();
      const salt = randomBytes(16);
      key = await deriveKey(password, salt, KDF_ITERATIONS);
      meta.kdf = { salt: toB64(salt), iterations: KDF_ITERATIONS };
      meta.check = toB64(await encryptBytes(key, strToU8(CHECK_TEXT)));
    }
    return { meta, key };
  }

  /**
   * 首次连接：云端为空时按本机设置初始化；云端已有数据时沿用云端的加密设置。
   * 返回云端是否加密。
   */
  async connect(opts: { encrypt: boolean; password?: string }): Promise<{ created: boolean; encrypted: boolean }> {
    const existing = await this.getMeta();
    if (existing) {
      if (existing.encrypted) {
        if (!(await this.keys.get(existing.epoch))) {
          if (!opts.password) throw new NeedPasswordError();
          await this.unlock(opts.password, existing);
        }
      }
      return { created: false, encrypted: existing.encrypted };
    }
    const { meta, key } = await this.newMeta(opts.encrypt, opts.password);
    if (key) await this.keys.set(meta.epoch, key);
    await this.putMeta(meta);
    return { created: true, encrypted: meta.encrypted };
  }

  // ---------- 编解码 ----------

  private async encode(obj: unknown, key: CryptoKey | null): Promise<Uint8Array> {
    const gz = gzipJson(obj);
    return key ? encryptBytes(key, gz) : gz;
  }

  private async decode<T>(bytes: Uint8Array, key: CryptoKey | null): Promise<T> {
    return gunzipJson<T>(key ? await decryptBytes(key, bytes) : bytes);
  }

  // ---------- 同步主流程 ----------

  async sync(): Promise<SyncReport> {
    const report: SyncReport = { pulledFiles: 0, pulledRecords: 0, pushedRecords: 0, conflicts: 0, snapshotApplied: false, compacted: false, changed: [] };
    const changed = new Set<TableName>();
    const meta = await this.getMeta();
    if (!meta) throw new NotInitializedError();
    const key = await this.keyFor(meta);
    let state = await this.stateStore.load();

    if (state.epoch !== meta.epoch) {
      // 新设备，或者其他设备切换了加密方式（纪元变化）：重新从快照开始
      state = { ...emptyState(), epoch: meta.epoch, needFullPush: state.epoch !== null, lastSync: state.lastSync };
      await this.stateStore.save(state);
    }

    // 1. 最新快照
    const snaps = (await listAll(this.storage, this.ep(meta.epoch, 'snapshots/'))).map((o) => o.key).sort();
    const latest = snaps[snaps.length - 1];
    if (latest && (!state.snapshotKey || latest > state.snapshotKey)) {
      const raw = await this.storage.get(latest);
      if (raw) {
        const snap = await this.decode<SnapshotFile>(raw, key);
        const r = await this.repo.applyRemote(snap.data);
        report.pulledRecords += r.taken;
        report.conflicts += r.conflicts;
        r.changed.forEach((t) => changed.add(t));
        for (const [dev, k] of Object.entries(snap.covers)) {
          if (!state.cursors[dev] || k > state.cursors[dev]) state.cursors[dev] = k;
        }
        state.snapshotKey = latest;
        state.uncovered = 0;
        report.snapshotApplied = true;
        await this.stateStore.save(state);
      }
    }

    // 2. 其他设备的增量
    const devs = await this.storage.list(this.ep(meta.epoch, 'changes/'), { delimiter: '/' });
    for (const p of devs.prefixes) {
      const dev = p.slice(0, -1).split('/').pop()!;
      if (dev === this.deviceId) continue;
      const files = await listAll(this.storage, p, state.cursors[dev]);
      for (const f of files.sort((a, b) => (a.key < b.key ? -1 : 1))) {
        const raw = await this.storage.get(f.key);
        if (raw) {
          const ch = await this.decode<ChangeFile>(raw, key);
          const r = await this.repo.applyRemote(ch.data);
          report.pulledRecords += r.taken;
          report.conflicts += r.conflicts;
          r.changed.forEach((t) => changed.add(t));
          state.uncovered++;
        }
        report.pulledFiles++;
        state.cursors[dev] = f.key;
        await this.stateStore.save(state);
      }
    }

    // 3. 推送本机修改
    report.pushedRecords = await this.push(meta, key, state);

    // 4. 压缩：增量文件过多时生成快照并清理
    if (state.uncovered >= this.threshold) {
      await this.compact(meta, key, state);
      report.compacted = true;
    }

    state.lastSync = this.now();
    await this.stateStore.save(state);
    report.changed = [...changed];
    return report;
  }

  private async push(meta: RemoteMeta, key: CryptoKey | null, state: SyncState): Promise<number> {
    const db = this.repo.db;
    let data: Partial<DataSet>;
    const outbox = await db.outbox.toArray();
    if (state.needFullPush) {
      data = await this.repo.readAll(true);
    } else {
      if (!outbox.length) return 0;
      data = {};
      for (const t of TABLES) {
        const ids = outbox.filter((o) => o.table === t).map((o) => o.id);
        if (!ids.length) continue;
        const rows = (await db.table_(t).bulkGet(ids)).filter(Boolean);
        if (rows.length) (data as any)[t] = rows;
      }
    }
    const count = TABLES.reduce((s, t) => s + (data[t]?.length || 0), 0);
    if (count) {
      const stamp = this.repo.hlc.tick().slice(0, 18);
      await db.setKv('hlc', this.repo.hlc.state);
      const fileKey = this.ep(meta.epoch, 'changes', this.deviceId, `${stamp}.bin`);
      const body: ChangeFile = { deviceId: this.deviceId, createdAt: this.now(), data };
      await this.storage.put(fileKey, await this.encode(body, key));
      state.cursors[this.deviceId] = fileKey;
      state.uncovered++;
    }
    // 只移除推送后没有再被修改的条目
    const pushed = new Map<string, string>();
    for (const t of TABLES) for (const r of data[t] || []) pushed.set(`${t}:${r.id}`, r.hlc);
    await db.transaction('rw', [db.outbox, ...TABLES.map((t) => db.table_(t))], async () => {
      for (const o of outbox) {
        const cur = await db.table_(o.table).get(o.id);
        if (!cur || cur.hlc === pushed.get(o.key)) await db.outbox.delete(o.key);
      }
    });
    state.needFullPush = false;
    await this.stateStore.save(state);
    return count;
  }

  private async compact(meta: RemoteMeta, key: CryptoKey | null, state: SyncState) {
    const data = await this.repo.readAll(true);
    const stamp = this.repo.hlc.tick().slice(0, 18);
    const snapKey = this.ep(meta.epoch, 'snapshots', `${stamp}_${this.deviceId}.bin`);
    const body: SnapshotFile = { deviceId: this.deviceId, createdAt: this.now(), covers: { ...state.cursors }, data };
    await this.storage.put(snapKey, await this.encode(body, key));
    state.snapshotKey = snapKey;
    state.uncovered = 0;
    await this.stateStore.save(state);

    // 清理：被快照覆盖且超过宽限期的增量文件；只保留最近几个快照
    const cutoff = this.now() - GRACE_MS;
    const devs = await this.storage.list(this.ep(meta.epoch, 'changes/'), { delimiter: '/' });
    for (const p of devs.prefixes) {
      const dev = p.slice(0, -1).split('/').pop()!;
      const cover = body.covers[dev];
      if (!cover) continue;
      for (const f of await listAll(this.storage, p)) {
        if (f.key <= cover && keyTime(f.key) < cutoff) await this.storage.delete(f.key);
      }
    }
    const snaps = (await listAll(this.storage, this.ep(meta.epoch, 'snapshots/'))).map((o) => o.key).sort();
    for (const s of snaps.slice(0, Math.max(0, snaps.length - KEEP_SNAPSHOTS))) await this.storage.delete(s);
  }

  /** 立即生成快照（例如手动“整理云端数据”） */
  async forceCompact() {
    const meta = await this.getMeta();
    if (!meta) throw new NotInitializedError();
    const key = await this.keyFor(meta);
    const state = await this.stateStore.load();
    await this.compact(meta, key, state);
  }

  /**
   * 切换加密方式 / 修改密码：先完整同步，再在新纪元写入快照与 meta，最后删除旧纪元数据。
   */
  async reencrypt(encrypt: boolean, password?: string) {
    await this.sync();
    const oldMeta = (await this.getMeta())!;
    const oldKey = await this.keyFor(oldMeta);
    const { meta, key } = await this.newMeta(encrypt, password);
    const data = await this.repo.readAll(true);
    const stamp = this.repo.hlc.tick().slice(0, 18);
    const snapKey = this.ep(meta.epoch, 'snapshots', `${stamp}_${this.deviceId}.bin`);
    await this.storage.put(snapKey, await this.encode({ deviceId: this.deviceId, createdAt: this.now(), covers: {}, data } satisfies SnapshotFile, key));
    // 迁移云端版本
    for (const v of await this.listRemoteVersions(oldMeta, oldKey)) {
      const raw = await this.storage.get(v.key);
      if (!raw) continue;
      const plain = await this.decode<unknown>(raw, oldKey);
      await this.putVersion(meta, key, v.meta, plain);
    }
    if (key) await this.keys.set(meta.epoch, key);
    await this.putMeta(meta);
    const state: SyncState = { ...emptyState(), epoch: meta.epoch, snapshotKey: snapKey, lastSync: this.now() };
    await this.stateStore.save(state);
    for (const o of await listAll(this.storage, this.ep(oldMeta.epoch) + '/')) await this.storage.delete(o.key);
    await this.keys.set(oldMeta.epoch, null);
  }

  // ---------- 云端版本 ----------

  private async putVersion(meta: RemoteMeta, key: CryptoKey | null, vm: VersionMeta, backup: unknown) {
    const metaBytes = key ? await encryptBytes(key, strToU8(JSON.stringify(vm))) : strToU8(JSON.stringify(vm));
    const objKey = this.ep(meta.epoch, 'versions', `${String(vm.createdAt).padStart(13, '0')}_${b64url(metaBytes)}.bin`);
    await this.storage.put(objKey, await this.encode(backup, key));
  }

  async uploadVersion(vm: VersionMeta, backup: unknown) {
    const meta = await this.getMeta();
    if (!meta) throw new NotInitializedError();
    const key = await this.keyFor(meta);
    await this.putVersion(meta, key, vm, backup);
  }

  async listRemoteVersions(meta?: RemoteMeta, key?: CryptoKey | null): Promise<{ key: string; meta: VersionMeta }[]> {
    meta = meta ?? (await this.getMeta()) ?? undefined;
    if (!meta) return [];
    if (key === undefined) key = await this.keyFor(meta);
    const out: { key: string; meta: VersionMeta }[] = [];
    for (const o of await listAll(this.storage, this.ep(meta.epoch, 'versions/'))) {
      try {
        const enc = o.key.split('/').pop()!.replace(/\.bin$/, '').split('_').slice(1).join('_');
        const bytes = fromB64url(enc);
        const json = key ? strFromU8(await decryptBytes(key, bytes)) : strFromU8(bytes);
        out.push({ key: o.key, meta: JSON.parse(json) });
      } catch {
        /* 忽略无法解析的对象 */
      }
    }
    return out.sort((a, b) => b.meta.createdAt - a.meta.createdAt);
  }

  async downloadVersion<T>(objKey: string): Promise<T> {
    const meta = await this.getMeta();
    if (!meta) throw new NotInitializedError();
    const key = await this.keyFor(meta);
    const raw = await this.storage.get(objKey);
    if (!raw) throw new Error('not found');
    return this.decode<T>(raw, key);
  }

  async deleteRemoteVersion(objKey: string) {
    await this.storage.delete(objKey);
  }

  /** 连通性测试：写、读、删一个探测文件 */
  async probe(): Promise<void> {
    const k = this.k(`.probe-${this.deviceId}`);
    const body = strToU8(`probe ${this.now()}`);
    await this.storage.put(k, body, 'text/plain');
    const got = await this.storage.get(k);
    if (!got || strFromU8(got) !== strFromU8(body)) throw new Error('probe read mismatch');
    await this.storage.delete(k);
  }
}
