import { app, externalChanged, getDb, getRepo, onLocalChange, saveSyncConfig } from '../app.svelte';
import { t } from '../i18n/index.svelte';
import type { VersionMeta } from '../types';
import { NeedPasswordError, NotInitializedError, SyncEngine, WrongPasswordError, emptyState, type SyncReport, type SyncState } from './engine';
import { S3Storage, StorageError } from './storage';

export type SyncPhase = 'disabled' | 'idle' | 'syncing' | 'error' | 'offline' | 'need-password';

class SyncStatus {
  phase = $state<SyncPhase>('disabled');
  message = $state<string | null>(null);
  lastSync = $state<number | null>(null);
  lastReport = $state<SyncReport | null>(null);
  log = $state<{ at: number; text: string; error?: boolean }[]>([]);
}

export const syncStatus = new SyncStatus();

let timer: ReturnType<typeof setTimeout> | null = null;
let interval: ReturnType<typeof setInterval> | null = null;
let running: Promise<void> | null = null;

function log(text: string, error = false) {
  syncStatus.log = [{ at: Date.now(), text, error }, ...syncStatus.log].slice(0, 30);
}

export function isConfigured() {
  const c = app.sync;
  return !!(c.bucket && c.accessKeyId && c.secretAccessKey && (c.provider === 'cos' ? c.region : c.endpoint));
}

export function makeEngine(): SyncEngine {
  const db = getDb();
  return new SyncEngine({
    repo: getRepo(),
    storage: new S3Storage(app.sync),
    prefix: app.sync.prefix || 'lyubishchev',
    keys: {
      // CryptoKey 以不可导出的形式保存在 IndexedDB 中
      get: async (epoch) => db.getKv<CryptoKey | null>(`syncKey:${epoch}`, null),
      set: async (epoch, key) => (key ? db.setKv(`syncKey:${epoch}`, key) : db.kv.delete(`syncKey:${epoch}`).then(() => {}))
    },
    state: {
      load: async () => ({ ...emptyState(), ...(await db.getKv<Partial<SyncState>>('syncState', {})) }),
      save: async (s) => db.setKv('syncState', s)
    }
  });
}

export function describeError(e: unknown): string {
  if (e instanceof NeedPasswordError) return t('sync.err.needPassword');
  if (e instanceof WrongPasswordError) return t('sync.err.wrongPassword');
  if (e instanceof NotInitializedError) return t('sync.err.notInitialized');
  if (e instanceof StorageError) {
    if (e.status === 0) return t('sync.err.network');
    if (e.status === 403) return t('sync.err.forbidden', { msg: e.message });
    if (e.status === 404) return t('sync.err.bucket', { msg: e.message });
    return e.message;
  }
  return (e as Error)?.message || String(e);
}

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = (navigator as any).locks;
  if (locks?.request) return locks.request('lyubishchev-sync', fn);
  return fn();
}

export async function runSync(reason = 'manual'): Promise<SyncReport | null> {
  if (!app.sync.enabled || !isConfigured()) {
    syncStatus.phase = 'disabled';
    return null;
  }
  if (!navigator.onLine) {
    syncStatus.phase = 'offline';
    return null;
  }
  if (running) {
    await running;
    return syncStatus.lastReport;
  }
  let report: SyncReport | null = null;
  running = (async () => {
    syncStatus.phase = 'syncing';
    try {
      report = await withLock(() => makeEngine().sync());
      syncStatus.lastReport = report;
      syncStatus.lastSync = Date.now();
      syncStatus.phase = 'idle';
      syncStatus.message = null;
      if (report.changed.length) await externalChanged(report.changed);
      else app.pending = await getDb().outbox.count();
      if (report.pulledRecords || report.pushedRecords || reason === 'manual')
        log(t('sync.log.done', { pulled: report.pulledRecords, pushed: report.pushedRecords }) + (report.conflicts ? ' · ' + t('sync.log.conflicts', { n: report.conflicts }) : ''));
    } catch (e) {
      console.error(e);
      syncStatus.phase = e instanceof NeedPasswordError ? 'need-password' : 'error';
      syncStatus.message = describeError(e);
      log(syncStatus.message, true);
    }
  })();
  await running;
  running = null;
  return report;
}

export function scheduleSync(delay = 15_000) {
  if (!app.sync.enabled || !app.sync.autoSync) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => runSync('auto'), delay);
}

export async function initSync() {
  const st = await getDb().getKv<Partial<SyncState>>('syncState', {});
  syncStatus.lastSync = st.lastSync ?? null;
  syncStatus.phase = app.sync.enabled && isConfigured() ? 'idle' : 'disabled';
  onLocalChange(() => scheduleSync());
  window.addEventListener('online', () => scheduleSync(1000));
  window.addEventListener('offline', () => app.sync.enabled && (syncStatus.phase = 'offline'));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleSync(800);
    else if (app.pending) runSync('auto');
  });
  if (interval) clearInterval(interval);
  interval = setInterval(() => document.visibilityState === 'visible' && app.sync.autoSync && runSync('auto'), 5 * 60_000);
  if (app.sync.enabled && app.sync.autoSync) scheduleSync(1500);
}

/** 测试连接（读写删一个探测文件） */
export async function probe() {
  await makeEngine().probe();
}

/** 读取云端状态：是否已有数据、是否加密 */
export async function inspectRemote() {
  return makeEngine().getMeta();
}

/** 启用同步：云端为空则按本机设置初始化，否则沿用云端设置 */
export async function connect(password?: string) {
  const engine = makeEngine();
  const r = await engine.connect({ encrypt: app.sync.encrypt, password });
  await saveSyncConfig({ enabled: true, encrypt: r.encrypted });
  syncStatus.phase = 'idle';
  log(r.created ? t('sync.log.created') : t('sync.log.connected'));
  await runSync('manual');
  return r;
}

export async function unlock(password: string) {
  await makeEngine().unlock(password);
  syncStatus.phase = 'idle';
  await runSync('manual');
}

export async function disconnect() {
  await saveSyncConfig({ enabled: false });
  syncStatus.phase = 'disabled';
}

/** 清除本机同步进度（下次同步时从云端重新下载并合并） */
export async function resetLocalSyncState() {
  const db = getDb();
  const st = await db.getKv<Partial<SyncState>>('syncState', {});
  await db.setKv('syncState', { ...emptyState(), epoch: st.epoch ?? null });
}

export async function changeEncryption(enable: boolean, password?: string) {
  await withLock(() => makeEngine().reencrypt(enable, password));
  await saveSyncConfig({ encrypt: enable });
  log(enable ? t('sync.log.encrypted') : t('sync.log.decrypted'));
}

export async function compactNow() {
  await withLock(() => makeEngine().forceCompact());
  log(t('sync.log.compacted'));
}

export async function uploadVersion(meta: VersionMeta, backup: unknown) {
  await makeEngine().uploadVersion(meta, backup);
}
export async function listRemoteVersions() {
  return makeEngine().listRemoteVersions();
}
export async function downloadRemoteVersion<T>(key: string) {
  return makeEngine().downloadVersion<T>(key);
}
export async function deleteRemoteVersion(key: string) {
  return makeEngine().deleteRemoteVersion(key);
}
