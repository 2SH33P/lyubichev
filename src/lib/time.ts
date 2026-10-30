import type { Entry, PeriodType } from './types';

export const MIN = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

export type Interval = [number, number];

/** 记录的实际投入区间（扣除暂停） */
export function activeIntervals(e: Pick<Entry, 'start' | 'end' | 'pauses'>, now = Date.now()): Interval[] {
  const end = e.end ?? now;
  if (end <= e.start) return [];
  const pauses = (e.pauses || [])
    .map((p) => [Math.max(p.start, e.start), Math.min(p.end ?? now, end)] as Interval)
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);
  const out: Interval[] = [];
  let cur = e.start;
  for (const [a, b] of pauses) {
    if (a > cur) out.push([cur, a]);
    cur = Math.max(cur, b);
  }
  if (end > cur) out.push([cur, end]);
  return out;
}

export function sumIntervals(list: Interval[]): number {
  return list.reduce((s, [a, b]) => s + (b - a), 0);
}

/** 纯时间（毫秒） */
export function netMs(e: Pick<Entry, 'start' | 'end' | 'pauses'>, now = Date.now()): number {
  return sumIntervals(activeIntervals(e, now));
}

export function grossMs(e: Pick<Entry, 'start' | 'end'>, now = Date.now()): number {
  return Math.max(0, (e.end ?? now) - e.start);
}

export function isPaused(e: Pick<Entry, 'pauses' | 'end'>): boolean {
  if (e.end !== null) return false;
  const last = e.pauses[e.pauses.length - 1];
  return !!last && last.end === null;
}

/** 合并重叠区间 */
export function unionIntervals(list: Interval[]): Interval[] {
  const s = list.filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  const out: Interval[] = [];
  for (const [a, b] of s) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

export function clipIntervals(list: Interval[], from: number, to: number): Interval[] {
  const out: Interval[] = [];
  for (const [a, b] of list) {
    const x = Math.max(a, from);
    const y = Math.min(b, to);
    if (y > x) out.push([x, y]);
  }
  return out;
}

/** 从 a 中减去 b（均为有序不重叠区间也可，内部会规范化） */
export function subtractIntervals(a: Interval[], b: Interval[]): Interval[] {
  const ub = unionIntervals(b);
  const out: Interval[] = [];
  for (const [s0, e0] of a) {
    let s = s0;
    for (const [bs, be] of ub) {
      if (be <= s || bs >= e0) continue;
      if (bs > s) out.push([s, bs]);
      s = Math.max(s, be);
      if (s >= e0) break;
    }
    if (s < e0) out.push([s, e0]);
  }
  return out;
}

export function startOfDay(t: number | Date): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function addDays(t: number, n: number): number {
  const d = new Date(t);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

export function dayKey(t: number | Date): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function parseDayKey(k: string): number {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1).getTime();
}

/** 把区间按自然日切分（本地时区） */
export function splitByDay(list: Interval[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const [a, b] of list) {
    let s = a;
    while (s < b) {
      const next = addDays(startOfDay(s), 1);
      const e = Math.min(b, next);
      const k = dayKey(s);
      out.set(k, (out.get(k) || 0) + (e - s));
      s = e;
    }
  }
  return out;
}

// ---------- 周期 ----------

export function weekStartOf(t: number, weekStart: 0 | 1): number {
  const d = new Date(startOfDay(t));
  const diff = (d.getDay() - weekStart + 7) % 7;
  d.setDate(d.getDate() - diff);
  return d.getTime();
}

export function periodKeyOf(type: PeriodType | 'day', t: number, weekStart: 0 | 1 = 1): string {
  const d = new Date(t);
  if (type === 'day') return dayKey(t);
  if (type === 'week') return dayKey(weekStartOf(t, weekStart));
  if (type === 'month') return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  return String(d.getFullYear());
}

/** 周期的 [开始, 结束) */
export function periodRange(type: PeriodType | 'day', key: string): Interval {
  if (type === 'day' || type === 'week') {
    const s = parseDayKey(key);
    return [s, addDays(s, type === 'day' ? 1 : 7)];
  }
  if (type === 'month') {
    const [y, m] = key.split('-').map(Number);
    return [new Date(y, m - 1, 1).getTime(), new Date(y, m, 1).getTime()];
  }
  const y = Number(key);
  return [new Date(y, 0, 1).getTime(), new Date(y + 1, 0, 1).getTime()];
}

export function shiftPeriod(type: PeriodType | 'day', key: string, delta: number, weekStart: 0 | 1 = 1): string {
  const [s] = periodRange(type, key);
  const d = new Date(s);
  if (type === 'day') d.setDate(d.getDate() + delta);
  else if (type === 'week') d.setDate(d.getDate() + delta * 7);
  else if (type === 'month') d.setMonth(d.getMonth() + delta);
  else d.setFullYear(d.getFullYear() + delta);
  return periodKeyOf(type, d.getTime(), weekStart);
}

export function daysInRange([a, b]: Interval): string[] {
  const out: string[] = [];
  for (let t = startOfDay(a); t < b; t = addDays(t, 1)) out.push(dayKey(t));
  return out;
}

// ---------- 格式化 ----------

export function pad2(n: number) {
  return String(n).padStart(2, '0');
}

/** 计时器样式 1:02:03 */
export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${pad2(m)}:${pad2(s % 60)}`;
}

/** 时长：zh「2小时20分」，en「2h 20m」 */
export function fmtDur(ms: number, lang: 'zh' | 'en' = 'zh'): string {
  const totalMin = Math.round(ms / MIN);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (lang === 'zh') {
    if (h && m) return `${h}小时${m}分`;
    if (h) return `${h}小时`;
    return `${m}分`;
  }
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

/** 小时数，保留一位小数 */
export function fmtHours(ms: number): string {
  const h = ms / HOUR;
  return h >= 100 ? h.toFixed(0) : h.toFixed(1);
}

export function fmtTime(t: number): string {
  const d = new Date(t);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function fmtDateTime(t: number): string {
  return `${dayKey(t)} ${fmtTime(t)}`;
}

/** <input type="datetime-local"> 的值 */
export function toLocalInput(t: number): string {
  const d = new Date(t);
  return `${dayKey(t)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function fromLocalInput(v: string): number {
  return new Date(v).getTime();
}

/** 将纯时长取整到 step 分钟，返回调整后的结束时间 */
export function roundEnd(e: Pick<Entry, 'start' | 'pauses'>, end: number, step: number): number {
  if (step <= 1) return end;
  const net = netMs({ ...e, end }, end);
  const stepMs = step * MIN;
  const rounded = Math.max(stepMs, Math.round(net / stepMs) * stepMs);
  return end + (rounded - net);
}
