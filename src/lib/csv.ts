import { uuid } from './ids';
import { CategoryIndex } from './stats';
import { dayKey, fmtTime, netMs, MIN, HOUR, DAY } from './time';
import type { Category, CategoryKind, Entry, Todo } from './types';

// ---------- 基础 CSV ----------

export function detectDelimiter(text: string): string {
  const line = text.split(/\r?\n/, 1)[0] || '';
  const counts = [',', ';', '\t'].map((d) => [d, line.split(d).length] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 1 ? counts[0][0] : ',';
}

export function parseCsv(text: string, delimiter?: string): string[][] {
  text = text.replace(/^\uFEFF/, '');
  const d = delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else q = false;
      } else field += c;
    } else if (c === '"' && field === '') q = true;
    else if (c === d) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

const esc = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rows: unknown[][]): string {
  return '\uFEFF' + rows.map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
}

// ---------- 导出 ----------

export const ENTRY_HEADERS = ['id', 'date', 'start', 'end', 'net_minutes', 'gross_minutes', 'category', 'kind', 'note', 'tags', 'output_amount', 'output_unit', 'todo'];

export function entriesToCsv(entries: Entry[], idx: CategoryIndex, todos: Map<string, Todo>): string {
  const rows: unknown[][] = [ENTRY_HEADERS];
  for (const e of [...entries].sort((a, b) => a.start - b.start)) {
    if (e.end === null) continue;
    rows.push([
      e.id,
      dayKey(e.start),
      `${dayKey(e.start)} ${fmtTime(e.start)}`,
      `${dayKey(e.end)} ${fmtTime(e.end)}`,
      Math.round(netMs(e) / MIN),
      Math.round((e.end - e.start) / MIN),
      idx.pathName(e.categoryId, '/'),
      idx.kindOf(e.categoryId),
      e.note,
      e.tags.join(';'),
      e.output?.amount ?? '',
      e.output?.unit ?? '',
      e.todoId ? todos.get(e.todoId)?.title ?? '' : ''
    ]);
  }
  return toCsv(rows);
}

export function todosToCsv(todos: Todo[], idx: CategoryIndex, actual: Map<string, number>): string {
  const rows: unknown[][] = [['id', 'title', 'status', 'priority', 'due', 'category', 'estimate_minutes', 'actual_minutes', 'tags', 'notes', 'completed_at']];
  for (const t of todos) {
    rows.push([
      t.id,
      t.title,
      t.status,
      t.priority,
      t.due ? (t.dueAllDay ? dayKey(t.due) : `${dayKey(t.due)} ${fmtTime(t.due)}`) : '',
      t.categoryId ? idx.pathName(t.categoryId, '/') : '',
      t.estimateMin ?? '',
      Math.round((actual.get(t.id) || 0) / MIN),
      t.tags.join(';'),
      t.notes,
      t.completedAt ? `${dayKey(t.completedAt)} ${fmtTime(t.completedAt)}` : ''
    ]);
  }
  return toCsv(rows);
}

// ---------- 导入 ----------

export type CsvField = 'start' | 'end' | 'date' | 'startTime' | 'endTime' | 'duration' | 'category' | 'kind' | 'note' | 'tags' | 'amount' | 'unit';
export const CSV_FIELDS: CsvField[] = ['date', 'start', 'end', 'startTime', 'endTime', 'duration', 'category', 'kind', 'note', 'tags', 'amount', 'unit'];
export type CsvMapping = Partial<Record<CsvField, number>>;

const ALIASES: Record<CsvField, string[]> = {
  date: ['date', '日期', 'start date', 'day'],
  start: ['start', '开始', '开始时间', 'from', 'start time', 'begin', 'started'],
  end: ['end', '结束', '结束时间', 'to', 'end time', 'finish', 'stopped'],
  startTime: ['start_time', 'starttime', '开始时刻'],
  endTime: ['end_time', 'endtime', '结束时刻'],
  duration: ['net_minutes', 'duration', 'minutes', '时长', '纯时间', '分钟', 'duration (min)'],
  category: ['category', '类别', '分类', 'activity type', 'activity', 'project', '项目', 'type'],
  kind: ['kind', '类型', '类别类型'],
  note: ['note', '备注', 'comment', 'description', '描述', '说明'],
  tags: ['tags', '标签', 'tag'],
  amount: ['output_amount', 'amount', '产出', '产出量'],
  unit: ['output_unit', 'unit', '单位']
};

export function guessMapping(headers: string[]): CsvMapping {
  const m: CsvMapping = {};
  const h = headers.map((x) => x.trim().toLowerCase());
  const used = new Set<number>();
  for (const f of CSV_FIELDS) {
    const i = h.findIndex((x, j) => !used.has(j) && ALIASES[f].includes(x));
    if (i >= 0) {
      m[f] = i;
      used.add(i);
    }
  }
  // Toggl 风格：Start date + Start time
  const sd = h.indexOf('start date');
  const st = h.indexOf('start time');
  if (sd >= 0 && st >= 0) {
    m.date = sd;
    m.startTime = st;
    delete m.start;
    const et = h.indexOf('end time');
    if (et >= 0) {
      m.endTime = et;
      delete m.end;
    }
  }
  return m;
}

/** 解析多种日期时间格式 */
export function parseDateTime(s: string): number | null {
  s = s.trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const [, y, mo, d, h = '0', mi = '0', se = '0'] = m;
    const tz = s.match(/(Z|[+-]\d{2}:?\d{2})$/);
    if (tz) {
      const t = Date.parse(s.replace(' ', 'T'));
      return Number.isFinite(t) ? t : null;
    }
    return new Date(+y, +mo - 1, +d, +h, +mi, +se).getTime();
  }
  const m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/); // MM/DD/YYYY
  if (m2) {
    const [, mo, d, y, h = '0', mi = '0', se = '0'] = m2;
    return new Date(+y, +mo - 1, +d, +h, +mi, +se).getTime();
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

export function parseClock(s: string): number | null {
  const m = s.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  return m ? (+m[1] * 3600 + +m[2] * 60 + +(m[3] || 0)) * 1000 : null;
}

/** 时长：90、1:30、1:30:00、1h 30m、1小时30分、1.5h */
export function parseDuration(s: string): number | null {
  s = s.trim().toLowerCase();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(parseFloat(s) * MIN);
  const c = s.match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (c) return (+c[1] * 3600 + +c[2] * 60 + +(c[3] || 0)) * 1000;
  let ms = 0;
  let ok = false;
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|小时|时|m|min|mins|minutes?|分钟|分|s|sec|秒)/g)) {
    ok = true;
    const v = parseFloat(m[1]);
    const u = m[2];
    if (/^(h|hr|hrs|hour|hours|小时|时)$/.test(u)) ms += v * HOUR;
    else if (/^(s|sec|秒)$/.test(u)) ms += v * 1000;
    else ms += v * MIN;
  }
  return ok ? Math.round(ms) : null;
}

const KIND_ALIASES: Record<string, CategoryKind> = {
  primary: 'primary', '第一类': 'primary', i: 'primary', '1': 'primary',
  secondary: 'secondary', '第二类': 'secondary', ii: 'secondary', '2': 'secondary',
  life: 'life', '生活': 'life'
};

export interface CsvImportResult {
  entries: Entry[];
  newCategories: Category[];
  errors: { row: number; message: string }[];
  duplicates: number;
}

const PALETTE = ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#38d9a9', '#4dabf7', '#748ffc', '#da77f2', '#f783ac', '#a9e34b'];

export function buildEntriesFromCsv(
  rows: string[][],
  mapping: CsvMapping,
  categories: Category[],
  existing: Entry[],
  deviceId: string,
  hasHeader = true
): CsvImportResult {
  const cats = [...categories.filter((c) => !c.deleted)];
  const newCategories: Category[] = [];
  const errors: CsvImportResult['errors'] = [];
  const out: Entry[] = [];
  let duplicates = 0;
  const now = Date.now();

  const findOrCreate = (path: string, kind: CategoryKind | undefined): string => {
    const parts = path.split(/\s*[/>›]\s*/).filter(Boolean);
    if (!parts.length) parts.push('未分类');
    let parent: string | null = null;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      let c = cats.find((x) => x.parentId === parent && x.name.toLowerCase() === name.toLowerCase());
      if (!c) {
        const parentCat: Category | undefined = parent ? cats.find((x) => x.id === parent) : undefined;
        c = {
          id: uuid(), name, parentId: parent, kind: kind ?? parentCat?.kind ?? 'secondary',
          color: parentCat?.color ?? PALETTE[cats.length % PALETTE.length], countAsWork: (kind ?? parentCat?.kind) !== 'life',
          order: cats.length, archived: false, createdAt: now, updatedAt: now, hlc: '', deviceId
        };
        cats.push(c);
        newCategories.push(c);
      }
      parent = c.id;
    }
    return parent!;
  };

  const idx0 = new CategoryIndex(categories);
  const sig = (start: number, net: number, catPath: string) => `${Math.round(start / MIN)}|${Math.round(net / MIN)}|${catPath.toLowerCase()}`;
  const seen = new Set(existing.filter((e) => !e.deleted && e.end !== null).map((e) => sig(e.start, netMs(e), idx0.pathName(e.categoryId, '/'))));

  const get = (r: string[], f: CsvField) => (mapping[f] !== undefined ? (r[mapping[f]!] ?? '').trim() : '');
  rows.slice(hasHeader ? 1 : 0).forEach((r, i) => {
    const rowNo = i + (hasHeader ? 2 : 1);
    try {
      let start: number | null = null;
      let end: number | null = null;
      const date = get(r, 'date');
      const dateMs = date ? parseDateTime(date) : null;
      if (mapping.start !== undefined) {
        const v = get(r, 'start');
        start = parseDateTime(v);
        if (start === null && dateMs !== null && parseClock(v) !== null) start = dateMs + parseClock(v)!;
      } else if (mapping.startTime !== undefined && dateMs !== null) {
        const c = parseClock(get(r, 'startTime'));
        if (c !== null) start = new Date(dateMs).setHours(0, 0, 0, 0) + c;
      }
      if (mapping.end !== undefined) {
        const v = get(r, 'end');
        end = parseDateTime(v);
        if (end === null && start !== null && parseClock(v) !== null) {
          end = new Date(start).setHours(0, 0, 0, 0) + parseClock(v)!;
          if (end <= start) end += DAY;
        }
      } else if (mapping.endTime !== undefined && start !== null) {
        const c = parseClock(get(r, 'endTime'));
        if (c !== null) {
          end = new Date(start).setHours(0, 0, 0, 0) + c;
          if (end <= start) end += DAY;
        }
      }
      const dur = mapping.duration !== undefined ? parseDuration(get(r, 'duration')) : null;
      if (start === null && dateMs !== null && dur !== null && end !== null) start = end - dur;
      if (start === null) throw new Error('start');
      if (end === null && dur !== null) end = start + dur;
      if (end === null || end <= start) throw new Error('end');

      // 如果纯时间短于起止跨度，用一个暂停段表示差值
      const pauses = dur !== null && dur > 0 && dur < end - start - MIN ? [{ start: start + dur, end }] : [];
      const catPath = get(r, 'category') || '未分类';
      const kindRaw = get(r, 'kind').toLowerCase();
      const categoryId = findOrCreate(catPath, KIND_ALIASES[kindRaw]);
      const e: Entry = {
        id: uuid(), categoryId, start, end, pauses, note: get(r, 'note'),
        tags: get(r, 'tags').split(/[;,，；#]\s*/).map((x) => x.trim()).filter(Boolean),
        output: get(r, 'amount') && !Number.isNaN(parseFloat(get(r, 'amount'))) ? { amount: parseFloat(get(r, 'amount')), unit: get(r, 'unit') } : null,
        source: 'import', todoId: null, createdAt: now, updatedAt: now, hlc: '', deviceId
      };
      const s = sig(start, netMs(e), catPath.split(/\s*[/>›]\s*/).filter(Boolean).join('/'));
      if (seen.has(s)) {
        duplicates++;
        return;
      }
      seen.add(s);
      out.push(e);
    } catch (err) {
      errors.push({ row: rowNo, message: (err as Error).message });
    }
  });
  return { entries: out, newCategories, errors, duplicates };
}
