import { AppDB } from './db';
import { ZERO_HLC } from './hlc';
import { randomId, uuid } from './ids';
import { i18n, detectLang, t } from './i18n/index.svelte';
import { isLockedAt, lockedRanges } from './lock';
import { Repo } from './repo';
import { CategoryIndex, cutEntry, findOverlaps, todoActuals } from './stats';
import { netMs, roundEnd, MIN } from './time';
import {
  DEFAULT_SETTINGS,
  DEFAULT_SYNC,
  TABLES,
  type AnyRecord,
  type Category,
  type Entry,
  type Plan,
  type RecordMap,
  type Review,
  type Settings,
  type SyncConfig,
  type TableName,
  type Todo
} from './types';
import { createVersion, ensureDailyVersion } from './versions';

// ---------- 全局状态 ----------

class AppState {
  ready = $state(false);
  error = $state<string | null>(null);
  categories = $state.raw<Category[]>([]);
  entries = $state.raw<Entry[]>([]);
  todos = $state.raw<Todo[]>([]);
  plans = $state.raw<Plan[]>([]);
  reviews = $state.raw<Review[]>([]);
  settings = $state<Settings>({ ...DEFAULT_SETTINGS });
  sync = $state<SyncConfig>({ ...DEFAULT_SYNC });
  now = $state(Date.now());
  pending = $state(0);

  idx = $derived(new CategoryIndex(this.categories));
  running = $derived(this.entries.filter((e) => e.end === null).sort((a, b) => a.start - b.start));
  locks = $derived(lockedRanges(this.reviews));
  todoActual = $derived(todoActuals(this.entries, this.now));
  todoById = $derived(new Map(this.todos.map((t) => [t.id, t])));
  /** 最近使用的类别（用于快速开始） */
  recentCategories = $derived.by(() => {
    const seen = new Map<string, number>();
    for (const e of this.entries) seen.set(e.categoryId, Math.max(seen.get(e.categoryId) || 0, e.start));
    return [...seen.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => this.idx.get(id))
      .filter((c): c is Category => !!c && !c.archived);
  });
}

export const app = new AppState();

let db: AppDB;
let repo: Repo;
let channel: BroadcastChannel | null = null;
const listeners = new Set<() => void>();

export const getRepo = () => repo;
export const getDb = () => db;

/** 数据变更后的回调（用于触发同步） */
export function onLocalChange(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---------- 初始化 ----------

export async function initApp() {
  try {
    db = new AppDB();
    await db.open();
    let deviceId = await db.getKv<string | null>('deviceId', null);
    if (!deviceId) {
      deviceId = randomId(10);
      await db.setKv('deviceId', deviceId);
    }
    repo = await Repo.open(db, deviceId);
    const s = await db.getKv<Partial<Settings> | null>('settings', null);
    app.settings = { ...DEFAULT_SETTINGS, lang: detectLang(), ...(s || {}) };
    i18n.lang = app.settings.lang;
    app.sync = { ...DEFAULT_SYNC, ...(await db.getKv<Partial<SyncConfig>>('syncConfig', {})) };
    await seedIfNeeded();
    await reloadAll();
    app.ready = true;
    ensureDailyVersion(repo).catch(console.error);
    repo.pruneHistory().catch(console.error);
    if ('BroadcastChannel' in window) {
      channel = new BroadcastChannel('lyubishchev-time');
      channel.onmessage = (ev) => {
        if (ev.data?.type === 'changed') reloadTables(ev.data.tables);
        if (ev.data?.type === 'settings') reloadSettings();
      };
    }
    startTicker();
    navigator.storage?.persist?.().catch(() => {});
  } catch (e) {
    console.error(e);
    app.error = (e as Error).message;
  }
}

let tickHandle: ReturnType<typeof setTimeout> | undefined;
/** 刷新 app.now；有计时进行时每秒刷新，否则每 30 秒 */
function tick() {
  clearTimeout(tickHandle);
  app.now = Date.now();
  const fast = app.running.length > 0 && document.visibilityState === 'visible';
  tickHandle = setTimeout(tick, fast ? 1000 - (Date.now() % 1000) + 5 : 30_000);
}

function startTicker() {
  tick();
  document.addEventListener('visibilitychange', tick);
  // 计时开始/结束（含其他设备同步过来的）时立即切换刷新频率
  $effect.root(() => {
    $effect(() => {
      void app.running.length;
      tick();
    });
  });
}

async function seedIfNeeded() {
  if (await db.getKv('seeded', false)) return;
  if ((await db.categories.count()) > 0) return db.setKv('seeded', true);
  const zh = app.settings.lang === 'zh';
  const mk = (id: string, name: string, en: string, kind: Category['kind'], color: string, parentId: string | null, order: number, unit?: string): Category => ({
    id: `seed-${id}`, name: zh ? name : en, parentId: parentId ? `seed-${parentId}` : null, kind, color,
    countAsWork: kind !== 'life', order, archived: false, createdAt: 0, updatedAt: 0, hlc: ZERO_HLC, deviceId: 'seed', ...(unit ? { unit } : {})
  });
  const list = [
    mk('primary', '核心工作', 'Core work', 'primary', '#5e5ce6', null, 0),
    mk('writing', '写作', 'Writing', 'primary', '#5e5ce6', 'primary', 0, zh ? '字' : 'words'),
    mk('research', '研究', 'Research', 'primary', '#0a84ff', 'primary', 1),
    mk('study', '学习', 'Study', 'primary', '#30b0c7', 'primary', 2, zh ? '页' : 'pages'),
    mk('secondary', '辅助工作', 'Support work', 'secondary', '#ff9f0a', null, 1),
    mk('meeting', '会议', 'Meetings', 'secondary', '#ff9f0a', 'secondary', 0),
    mk('mail', '通信', 'Communication', 'secondary', '#ffb340', 'secondary', 1),
    mk('chores', '杂务', 'Chores', 'secondary', '#ac8e68', 'secondary', 2),
    mk('life', '生活', 'Life', 'life', '#34c759', null, 2),
    mk('sleep', '睡眠', 'Sleep', 'life', '#64d2ff', 'life', 0),
    mk('sport', '运动', 'Exercise', 'life', '#30d158', 'life', 1),
    mk('commute', '通勤', 'Commute', 'life', '#8e8e93', 'life', 2),
    mk('leisure', '休闲', 'Leisure', 'life', '#ff375f', 'life', 3)
  ];
  // 种子数据使用固定 ID 与最小时间戳：多设备不会产生重复，且任何修改都会覆盖它
  await db.categories.bulkPut(list);
  await db.setKv('seeded', true);
}

const live = <T extends AnyRecord>(rows: T[]) => rows.filter((r) => !r.deleted);

async function loadTable<K extends TableName>(t: K) {
  const rows = live((await db.table_(t).toArray()) as RecordMap[K][]);
  (app as any)[t] = rows;
}

export async function reloadAll() {
  await Promise.all(TABLES.map(loadTable));
  app.pending = await db.outbox.count();
}

export async function reloadTables(tables: TableName[]) {
  await Promise.all(tables.map(loadTable));
  app.pending = await db.outbox.count();
}

async function reloadSettings() {
  const s = await db.getKv<Partial<Settings> | null>('settings', null);
  app.settings = { ...DEFAULT_SETTINGS, ...(s || {}) };
  i18n.lang = app.settings.lang;
  app.sync = { ...DEFAULT_SYNC, ...(await db.getKv<Partial<SyncConfig>>('syncConfig', {})) };
}

async function changed(tables: TableName[]) {
  await reloadTables(tables);
  channel?.postMessage({ type: 'changed', tables });
  listeners.forEach((f) => f());
}

/** 同步或恢复后由外部调用 */
export async function externalChanged(tables: TableName[] = TABLES) {
  await reloadTables(tables);
  channel?.postMessage({ type: 'changed', tables });
}

export async function saveSettings(patch: Partial<Settings>) {
  app.settings = { ...app.settings, ...patch };
  if (patch.lang) i18n.lang = patch.lang;
  await db.setKv('settings', $state.snapshot(app.settings));
  channel?.postMessage({ type: 'settings' });
}

export async function saveSyncConfig(patch: Partial<SyncConfig>) {
  app.sync = { ...app.sync, ...patch };
  await db.setKv('syncConfig', $state.snapshot(app.sync));
  channel?.postMessage({ type: 'settings' });
}

// ---------- 通用 ----------

function baseFields() {
  const now = Date.now();
  return { id: uuid(), createdAt: now, updatedAt: now, hlc: '', deviceId: repo.deviceId };
}

export class ActionError extends Error {}

export function isLocked(t: number) {
  return isLockedAt(t, app.locks);
}

// ---------- 时间记录 ----------

export async function startTimer(categoryId: string, opts: { todoId?: string | null; note?: string } = {}) {
  const now = Date.now();
  if (!app.settings.allowOverlap) for (const r of app.running) await stopTimer(r.id, now);
  const e: Entry = {
    ...baseFields(), categoryId, start: now, end: null, pauses: [], note: opts.note ?? '', tags: [], output: null,
    source: 'timer', todoId: opts.todoId ?? null
  };
  await repo.put('entries', [e]);
  if (opts.todoId) {
    const td = app.todoById.get(opts.todoId);
    if (td && td.status === 'todo') await repo.put('todos', [{ ...td, status: 'doing' }]);
  }
  await changed(['entries', 'todos']);
  return e;
}

export async function pauseTimer(id: string) {
  const e = app.entries.find((x) => x.id === id);
  if (!e || e.end !== null) return;
  const last = e.pauses[e.pauses.length - 1];
  if (last && last.end === null) return;
  await repo.put('entries', [{ ...e, pauses: [...e.pauses, { start: Date.now(), end: null }] }]);
  await changed(['entries']);
}

export async function resumeTimer(id: string) {
  const e = app.entries.find((x) => x.id === id);
  if (!e || e.end !== null) return;
  const pauses = e.pauses.map((p) => (p.end === null ? { ...p, end: Date.now() } : p));
  await repo.put('entries', [{ ...e, pauses }]);
  await changed(['entries']);
}

/** 结束计时；返回 'discarded' 表示太短被丢弃 */
export async function stopTimer(id: string, at = Date.now()): Promise<'saved' | 'discarded' | null> {
  const e = app.entries.find((x) => x.id === id);
  if (!e || e.end !== null) return null;
  const pauses = e.pauses.map((p) => (p.end === null ? { ...p, end: at } : p));
  const end = roundEnd({ start: e.start, pauses }, at, app.settings.roundTo);
  const done = { ...e, pauses, end };
  if (netMs(done, end) < app.settings.minEntryMin * MIN) {
    await repo.remove('entries', [id]);
    await changed(['entries']);
    return 'discarded';
  }
  await repo.put('entries', [done]);
  await changed(['entries']);
  return 'saved';
}

export async function discardTimer(id: string) {
  await repo.remove('entries', [id]);
  await changed(['entries']);
}

/** 快速修改备注（不做重叠检查） */
export async function setEntryNote(id: string, note: string) {
  const e = app.entries.find((x) => x.id === id);
  if (!e || e.note === note) return;
  await repo.put('entries', [{ ...e, note }]);
  await changed(['entries']);
}

export function newEntryDraft(start: number, end: number, categoryId?: string): Entry {
  return {
    ...baseFields(), categoryId: categoryId ?? app.recentCategories[0]?.id ?? app.categories[0]?.id ?? '',
    start, end, pauses: [], note: '', tags: [], output: null, source: 'manual', todoId: null
  };
}

export interface SaveEntryResult {
  ok: boolean;
  conflicts?: Entry[];
}

/** 保存记录；禁止重叠时返回冲突列表，trim=true 时自动裁剪其他记录 */
export async function saveEntry(e: Entry, opts: { trim?: boolean; force?: boolean } = {}): Promise<SaveEntryResult> {
  if (!app.idx.get(e.categoryId)) throw new ActionError(t('err.noCategory'));
  if (e.end !== null && e.end <= e.start) throw new ActionError(t('err.endBeforeStart'));
  const prev = app.entries.find((x) => x.id === e.id);
  if (isLocked(e.start) || (prev && isLocked(prev.start))) throw new ActionError(t('err.locked'));
  const now = Date.now();
  if (!app.settings.allowOverlap && !opts.force) {
    const conflicts = findOverlaps(app.entries, e, now);
    if (conflicts.length && !opts.trim) return { ok: false, conflicts };
    if (conflicts.length && opts.trim) {
      if (conflicts.some((c) => isLocked(c.start))) throw new ActionError(t('err.locked'));
      const updates: Entry[] = [];
      const removes: string[] = [];
      for (const c of conflicts) {
        const pieces = cutEntry(c, [e.start, e.end ?? now], now);
        if (!pieces.length) removes.push(c.id);
        pieces.forEach((p, i) => {
          if (i === 0) updates.push({ ...c, ...p, end: c.end === null && p.end >= now ? null : p.end });
          else updates.push({ ...c, ...baseFields(), ...p });
        });
      }
      if (removes.length) await repo.remove('entries', removes);
      if (updates.length) await repo.put('entries', updates);
    }
  }
  await repo.put('entries', [e]);
  await changed(['entries']);
  return { ok: true };
}

export async function deleteEntries(ids: string[]) {
  const list = app.entries.filter((e) => ids.includes(e.id));
  if (list.some((e) => isLocked(e.start))) throw new ActionError(t('err.locked'));
  if (ids.length >= 5) await createVersion(repo, 'pre-bulk-delete');
  await repo.remove('entries', ids);
  await changed(['entries']);
}

// ---------- 待办 ----------

export function newTodoDraft(title = ''): Todo {
  return {
    ...baseFields(), title, notes: '', due: null, dueAllDay: true, priority: 0, status: 'todo', categoryId: null,
    estimateMin: null, tags: [], subtasks: [], completedAt: null, order: Date.now()
  };
}

export async function saveTodo(td: Todo) {
  if (!td.title.trim()) throw new ActionError(t('err.titleRequired'));
  const next = { ...td };
  if (next.status === 'done' && !next.completedAt) next.completedAt = Date.now();
  if (next.status !== 'done') next.completedAt = null;
  await repo.put('todos', [next]);
  await changed(['todos']);
}

export async function toggleTodo(td: Todo) {
  const done = td.status !== 'done';
  if (done) for (const r of app.running.filter((r) => r.todoId === td.id)) await stopTimer(r.id);
  await repo.put('todos', [{ ...td, status: done ? 'done' : 'todo', completedAt: done ? Date.now() : null }]);
  await changed(['todos', 'entries']);
}

export async function deleteTodo(id: string) {
  await repo.remove('todos', [id]);
  await changed(['todos']);
}

// ---------- 类别 ----------

export function newCategoryDraft(parentId: string | null = null): Category {
  const parent = parentId ? app.idx.get(parentId) : undefined;
  return {
    ...baseFields(), name: '', parentId, kind: parent?.kind ?? 'primary', color: parent?.color ?? '#0a84ff',
    countAsWork: parent ? parent.countAsWork : true, order: (parentId ? app.idx.kids(parentId) : app.idx.roots()).length, archived: false
  };
}

export async function saveCategory(c: Category) {
  if (!c.name.trim()) throw new ActionError(t('err.nameRequired'));
  if (c.parentId && app.idx.descendants(c.id).includes(c.parentId)) throw new ActionError(t('err.parentCycle'));
  await repo.put('categories', [c]);
  await changed(['categories']);
}

export async function deleteCategory(id: string) {
  if (app.idx.kids(id).length) throw new ActionError(t('err.categoryHasChildren'));
  if (app.entries.some((e) => e.categoryId === id)) throw new ActionError(t('err.categoryInUse'));
  await repo.remove('categories', [id]);
  await changed(['categories']);
}

export async function moveCategory(id: string, dir: -1 | 1) {
  const c = app.idx.get(id);
  if (!c) return;
  const siblings = c.parentId ? app.idx.kids(c.parentId) : app.idx.roots();
  const i = siblings.findIndex((x) => x.id === id);
  const j = i + dir;
  if (j < 0 || j >= siblings.length) return;
  const arr = [...siblings];
  [arr[i], arr[j]] = [arr[j], arr[i]];
  await repo.put('categories', arr.map((x, k) => ({ ...x, order: k })));
  await changed(['categories']);
}

// ---------- 计划与复盘 ----------

export function findPlan(type: Plan['periodType'], key: string) {
  return app.plans.find((p) => p.periodType === type && p.periodKey === key);
}

export async function savePlan(type: Plan['periodType'], key: string, patch: Partial<Pick<Plan, 'targets' | 'note'>>) {
  const existing = findPlan(type, key);
  const p: Plan = existing ? { ...existing, ...patch } : { ...baseFields(), periodType: type, periodKey: key, targets: [], note: '', ...patch };
  p.targets = p.targets.filter((x) => x.minutes > 0);
  await repo.put('plans', [p]);
  await changed(['plans']);
}

export function findReview(type: Review['periodType'], key: string) {
  return app.reviews.find((r) => r.periodType === type && r.periodKey === key);
}

export async function saveReview(type: Review['periodType'], key: string, patch: Partial<Pick<Review, 'text' | 'locked' | 'statsSnapshot'>>) {
  const existing = findReview(type, key);
  const r: Review = existing ? { ...existing, ...patch } : { ...baseFields(), periodType: type, periodKey: key, text: '', locked: false, statsSnapshot: null, ...patch };
  await repo.put('reviews', [r]);
  await changed(['reviews']);
}

// ---------- 历史 ----------

export async function restoreFromHistory(table: TableName, data: AnyRecord) {
  const cur = ((await db.table_(table).get(data.id)) as AnyRecord | undefined) ?? data;
  await repo.put(table, [{ ...data, hlc: cur.hlc, deleted: undefined } as any], 'restore');
  await changed([table]);
}

export { netMs };
