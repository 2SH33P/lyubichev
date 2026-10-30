import {
  activeIntervals,
  clipIntervals,
  dayKey,
  addDays,
  startOfDay,
  subtractIntervals,
  sumIntervals,
  unionIntervals,
  HOUR,
  MIN,
  type Interval
} from './time';
import type { Category, CategoryKind, Entry, Plan, Settings, Todo } from './types';

export class CategoryIndex {
  byId = new Map<string, Category>();
  children = new Map<string | null, Category[]>();
  constructor(public list: Category[]) {
    for (const c of list) this.byId.set(c.id, c);
    for (const c of list) {
      const p = c.parentId && this.byId.has(c.parentId) ? c.parentId : null;
      if (!this.children.has(p)) this.children.set(p, []);
      this.children.get(p)!.push(c);
    }
    for (const arr of this.children.values()) arr.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  }
  get(id: string | null | undefined) {
    return id ? this.byId.get(id) : undefined;
  }
  roots() {
    return this.children.get(null) || [];
  }
  kids(id: string) {
    return this.children.get(id) || [];
  }
  path(id: string): Category[] {
    const out: Category[] = [];
    let c = this.byId.get(id);
    const seen = new Set<string>();
    while (c && !seen.has(c.id)) {
      seen.add(c.id);
      out.unshift(c);
      c = c.parentId ? this.byId.get(c.parentId) : undefined;
    }
    return out;
  }
  pathName(id: string, sep = ' / ') {
    const p = this.path(id);
    return p.length ? p.map((c) => c.name).join(sep) : '?';
  }
  root(id: string) {
    return this.path(id)[0];
  }
  descendants(id: string): string[] {
    const out = [id];
    for (let i = 0; i < out.length; i++) for (const k of this.kids(out[i])) out.push(k.id);
    return out;
  }
  /** 深度优先展开（用于选择器、树形列表） */
  flatten(includeArchived = false): { cat: Category; depth: number }[] {
    const out: { cat: Category; depth: number }[] = [];
    const walk = (parent: string | null, depth: number) => {
      for (const c of this.children.get(parent) || []) {
        if (!includeArchived && c.archived) continue;
        out.push({ cat: c, depth });
        walk(c.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }
  kindOf(id: string): CategoryKind {
    return this.byId.get(id)?.kind ?? 'secondary';
  }
  isWork(id: string): boolean {
    const c = this.byId.get(id);
    return c ? c.countAsWork : true;
  }
}

export interface DayBucket {
  primary: number;
  secondary: number;
  life: number;
  total: number;
}

export interface OutputStat {
  categoryId: string;
  unit: string;
  amount: number;
  ms: number;
}

export interface RangeStats {
  range: Interval;
  byCategory: Map<string, number>;
  byCategoryRollup: Map<string, number>;
  byKind: Record<CategoryKind, number>;
  /** 去重后的总记录时长 */
  totalMs: number;
  /** 去重后的工作时长（计入工作时间的类别） */
  workMs: number;
  /** 去重后的第一类时长 */
  primaryMs: number;
  byDay: Map<string, DayBucket>;
  byTag: Map<string, number>;
  outputs: OutputStat[];
  entryCount: number;
  daysWithRecords: number;
}

export function computeStats(entries: Entry[], idx: CategoryIndex, range: Interval, now = Date.now()): RangeStats {
  const [from, to] = range;
  const byCategory = new Map<string, number>();
  const byKind: Record<CategoryKind, number> = { primary: 0, secondary: 0, life: 0 };
  const byDay = new Map<string, DayBucket>();
  const byTag = new Map<string, number>();
  const outputs = new Map<string, OutputStat>();
  const all: Interval[] = [];
  const work: Interval[] = [];
  const primary: Interval[] = [];
  let entryCount = 0;

  for (const e of entries) {
    if (e.deleted) continue;
    if ((e.end ?? now) <= from || e.start >= to) continue;
    const iv = clipIntervals(activeIntervals(e, now), from, to);
    const ms = sumIntervals(iv);
    if (ms <= 0) continue;
    entryCount++;
    const kind = idx.kindOf(e.categoryId);
    byCategory.set(e.categoryId, (byCategory.get(e.categoryId) || 0) + ms);
    byKind[kind] += ms;
    for (const t of e.tags) byTag.set(t, (byTag.get(t) || 0) + ms);
    all.push(...iv);
    if (idx.isWork(e.categoryId)) work.push(...iv);
    if (kind === 'primary') primary.push(...iv);
    // 按日拆分
    for (const [a, b] of iv) {
      let s = a;
      while (s < b) {
        const next = addDays(startOfDay(s), 1);
        const x = Math.min(b, next);
        const k = dayKey(s);
        const bucket = byDay.get(k) || { primary: 0, secondary: 0, life: 0, total: 0 };
        bucket[kind] += x - s;
        bucket.total += x - s;
        byDay.set(k, bucket);
        s = x;
      }
    }
    if (e.output && e.output.amount && e.start >= from) {
      const key = `${e.categoryId}|${e.output.unit}`;
      const o = outputs.get(key) || { categoryId: e.categoryId, unit: e.output.unit, amount: 0, ms: 0 };
      o.amount += e.output.amount;
      o.ms += ms;
      outputs.set(key, o);
    }
  }

  const byCategoryRollup = new Map<string, number>();
  for (const [cid, ms] of byCategory) {
    for (const c of idx.path(cid)) byCategoryRollup.set(c.id, (byCategoryRollup.get(c.id) || 0) + ms);
    if (!idx.get(cid)) byCategoryRollup.set(cid, (byCategoryRollup.get(cid) || 0) + ms);
  }

  return {
    range,
    byCategory,
    byCategoryRollup,
    byKind,
    totalMs: sumIntervals(unionIntervals(all)),
    workMs: sumIntervals(unionIntervals(work)),
    primaryMs: sumIntervals(unionIntervals(primary)),
    byDay,
    byTag,
    outputs: [...outputs.values()].sort((a, b) => b.ms - a.ms),
    entryCount,
    daysWithRecords: [...byDay.values()].filter((d) => d.total > 0).length
  };
}

/** 一天中的未记录时间段 */
export function gapsForDay(entries: Entry[], day: number, s: Pick<Settings, 'gapMin' | 'dayStartHour' | 'dayEndHour'>, now = Date.now()): Interval[] {
  if (!s.gapMin) return [];
  const d0 = startOfDay(day);
  const from = d0 + s.dayStartHour * HOUR;
  const to = Math.min(d0 + s.dayEndHour * HOUR, now);
  if (to <= from) return [];
  const covered = entries
    .filter((e) => !e.deleted && (e.end ?? now) > from && e.start < to)
    .map((e) => [e.start, e.end ?? now] as Interval);
  return subtractIntervals([[from, to]], covered).filter(([a, b]) => b - a >= s.gapMin * MIN);
}

/** 与候选时间段重叠的记录 */
export function findOverlaps(entries: Entry[], candidate: { id?: string; start: number; end: number | null }, now = Date.now()): Entry[] {
  const cs = candidate.start;
  const ce = candidate.end ?? now;
  return entries.filter((e) => !e.deleted && e.id !== candidate.id && e.start < ce && (e.end ?? now) > cs);
}

/** 从记录中扣除一段时间，返回剩余的片段（0~2 段） */
export function cutEntry(e: Entry, [cs, ce]: Interval, now = Date.now()): { start: number; end: number; pauses: Entry['pauses'] }[] {
  const end = e.end ?? now;
  const pieces = subtractIntervals([[e.start, end]], [[cs, ce]]);
  return pieces.map(([a, b]) => ({
    start: a,
    end: b,
    pauses: e.pauses
      .map((p) => ({ start: Math.max(p.start, a), end: Math.min(p.end ?? b, b) }))
      .filter((p) => p.end > p.start)
  }));
}

export interface PlanRow {
  categoryId: string;
  targetMs: number;
  actualMs: number;
  ratio: number;
}

export function planProgress(plan: Plan | undefined, stats: RangeStats): PlanRow[] {
  if (!plan) return [];
  return plan.targets
    .filter((t) => t.minutes > 0)
    .map((t) => {
      const actualMs = stats.byCategoryRollup.get(t.categoryId) || 0;
      const targetMs = t.minutes * MIN;
      return { categoryId: t.categoryId, targetMs, actualMs, ratio: targetMs ? actualMs / targetMs : 0 };
    });
}

/** 每个待办累计投入的时间 */
export function todoActuals(entries: Entry[], now = Date.now()): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of entries) {
    if (e.deleted || !e.todoId) continue;
    m.set(e.todoId, (m.get(e.todoId) || 0) + sumIntervals(activeIntervals(e, now)));
  }
  return m;
}

/** 预估准确度：已完成且有预估的待办，实际/预估 */
export function estimateAccuracy(todos: Todo[], actuals: Map<string, number>, range: Interval) {
  const rows = todos
    .filter((t) => !t.deleted && t.status === 'done' && t.estimateMin && t.completedAt && t.completedAt >= range[0] && t.completedAt < range[1])
    .map((t) => ({ todo: t, estimateMs: t.estimateMin! * MIN, actualMs: actuals.get(t.id) || 0 }))
    .filter((r) => r.actualMs > 0);
  const est = rows.reduce((s, r) => s + r.estimateMs, 0);
  const act = rows.reduce((s, r) => s + r.actualMs, 0);
  return { rows, ratio: est ? act / est : 0 };
}
