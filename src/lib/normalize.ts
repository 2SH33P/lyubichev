import { ZERO_HLC } from './hlc';
import type { AnyRecord, Category, DataSet, Entry, Plan, Review, TableName, Todo } from './types';
import { TABLES } from './types';

const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

function base(r: any) {
  if (!r || typeof r.id !== 'string' || !r.id) throw new Error('record without id');
  const now = Date.now();
  return {
    id: r.id,
    createdAt: num(r.createdAt, now),
    updatedAt: num(r.updatedAt, num(r.createdAt, now)),
    hlc: str(r.hlc, ZERO_HLC),
    deviceId: str(r.deviceId, 'unknown'),
    ...(r.deleted ? { deleted: true } : {})
  };
}

const KINDS = ['primary', 'secondary', 'life'];
const STATUSES = ['todo', 'doing', 'done', 'cancelled'];
const PERIODS = ['week', 'month', 'year'];

export function normalizeRecord(table: TableName, r: any): AnyRecord {
  const b = base(r);
  switch (table) {
    case 'categories':
      return {
        ...b,
        name: str(r.name, '未命名'),
        parentId: typeof r.parentId === 'string' && r.parentId ? r.parentId : null,
        kind: KINDS.includes(r.kind) ? r.kind : 'secondary',
        color: str(r.color, '#8e8e93'),
        countAsWork: r.countAsWork !== false,
        order: num(r.order, 0),
        archived: !!r.archived,
        ...(r.unit ? { unit: str(r.unit) } : {})
      } satisfies Category;
    case 'entries': {
      const start = num(r.start, NaN);
      if (!Number.isFinite(start)) throw new Error('entry without start');
      return {
        ...b,
        categoryId: str(r.categoryId),
        start,
        end: numOrNull(r.end),
        pauses: arr<any>(r.pauses)
          .filter((p) => p && typeof p.start === 'number')
          .map((p) => ({ start: p.start, end: numOrNull(p.end) })),
        note: str(r.note),
        tags: arr<unknown>(r.tags).filter((x): x is string => typeof x === 'string'),
        output:
          r.output && typeof r.output.amount === 'number' ? { amount: r.output.amount, unit: str(r.output.unit) } : null,
        source: ['timer', 'manual', 'import'].includes(r.source) ? r.source : 'manual',
        todoId: typeof r.todoId === 'string' ? r.todoId : null
      } satisfies Entry;
    }
    case 'todos':
      return {
        ...b,
        title: str(r.title, '未命名'),
        notes: str(r.notes),
        due: numOrNull(r.due),
        dueAllDay: r.dueAllDay !== false,
        priority: ([0, 1, 2, 3].includes(r.priority) ? r.priority : 0) as Todo['priority'],
        status: STATUSES.includes(r.status) ? r.status : 'todo',
        categoryId: typeof r.categoryId === 'string' && r.categoryId ? r.categoryId : null,
        estimateMin: numOrNull(r.estimateMin),
        tags: arr<unknown>(r.tags).filter((x): x is string => typeof x === 'string'),
        subtasks: arr<any>(r.subtasks)
          .filter((s) => s && typeof s.id === 'string')
          .map((s) => ({ id: s.id, title: str(s.title), done: !!s.done })),
        completedAt: numOrNull(r.completedAt),
        order: num(r.order, 0)
      } satisfies Todo;
    case 'plans':
      return {
        ...b,
        periodType: PERIODS.includes(r.periodType) ? r.periodType : 'month',
        periodKey: str(r.periodKey),
        targets: arr<any>(r.targets)
          .filter((x) => x && typeof x.categoryId === 'string')
          .map((x) => ({ categoryId: x.categoryId, minutes: num(x.minutes, 0) })),
        note: str(r.note)
      } satisfies Plan;
    case 'reviews':
      return {
        ...b,
        periodType: PERIODS.includes(r.periodType) ? r.periodType : 'month',
        periodKey: str(r.periodKey),
        text: str(r.text),
        locked: !!r.locked,
        statsSnapshot: r.statsSnapshot ?? null
      } satisfies Review;
  }
}

/** 规范化整套数据，返回结果与被丢弃的条数 */
export function normalizeDataSet(input: any): { data: DataSet; invalid: number } {
  let invalid = 0;
  const data = {} as DataSet;
  for (const t of TABLES) {
    const list = Array.isArray(input?.[t]) ? input[t] : [];
    const out: any[] = [];
    for (const r of list) {
      try {
        out.push(normalizeRecord(t, r));
      } catch {
        invalid++;
      }
    }
    (data as any)[t] = out;
  }
  return { data, invalid };
}

export function emptyDataSet(): DataSet {
  return { categories: [], entries: [], todos: [], plans: [], reviews: [] };
}

const META = new Set(['hlc', 'updatedAt', 'deviceId', 'createdAt']);
/** 比较两条记录的业务内容是否相同（忽略同步元数据） */
export function sameContent(a: any, b: any): boolean {
  const strip = (o: any) => {
    const x: any = {};
    for (const k of Object.keys(o).sort()) if (!META.has(k) && o[k] !== undefined) x[k] = o[k];
    if (!x.deleted) delete x.deleted;
    return JSON.stringify(x);
  };
  return strip(a) === strip(b);
}
