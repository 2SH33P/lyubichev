export const SCHEMA_VERSION = 1;

/** 所有可同步记录的公共字段 */
export interface Base {
  id: string;
  createdAt: number;
  updatedAt: number;
  /** 混合逻辑时钟，用于多端合并（字符串可直接比较大小） */
  hlc: string;
  deviceId: string;
  deleted?: boolean;
}

/** primary=第一类（核心创造性工作），secondary=第二类（辅助工作），life=生活 */
export type CategoryKind = 'primary' | 'secondary' | 'life';

export interface Category extends Base {
  name: string;
  parentId: string | null;
  kind: CategoryKind;
  color: string;
  /** 是否计入"工作时间" */
  countAsWork: boolean;
  order: number;
  archived: boolean;
  /** 默认产出单位，例如"页" */
  unit?: string;
}

export interface Pause {
  start: number;
  end: number | null;
}

export interface Output {
  amount: number;
  unit: string;
}

export type EntrySource = 'timer' | 'manual' | 'import';

export interface Entry extends Base {
  categoryId: string;
  start: number;
  /** null 表示计时进行中 */
  end: number | null;
  pauses: Pause[];
  note: string;
  tags: string[];
  output?: Output | null;
  source: EntrySource;
  todoId?: string | null;
}

export type TodoStatus = 'todo' | 'doing' | 'done' | 'cancelled';

export interface Subtask {
  id: string;
  title: string;
  done: boolean;
}

export interface Todo extends Base {
  title: string;
  notes: string;
  /** 截止时间（毫秒）；allDay 时只看日期 */
  due: number | null;
  dueAllDay: boolean;
  /** 0 无，1 低，2 中，3 高 */
  priority: 0 | 1 | 2 | 3;
  status: TodoStatus;
  categoryId: string | null;
  estimateMin: number | null;
  tags: string[];
  subtasks: Subtask[];
  completedAt: number | null;
  order: number;
}

export type PeriodType = 'week' | 'month' | 'year';

export interface PlanTarget {
  categoryId: string;
  minutes: number;
}

export interface Plan extends Base {
  periodType: PeriodType;
  periodKey: string;
  targets: PlanTarget[];
  note: string;
}

export interface Review extends Base {
  periodType: PeriodType;
  periodKey: string;
  text: string;
  locked: boolean;
  statsSnapshot: unknown | null;
}

export type TableName = 'categories' | 'entries' | 'todos' | 'plans' | 'reviews';
export const TABLES: TableName[] = ['categories', 'entries', 'todos', 'plans', 'reviews'];

export interface RecordMap {
  categories: Category;
  entries: Entry;
  todos: Todo;
  plans: Plan;
  reviews: Review;
}

export type AnyRecord = RecordMap[TableName];

export type DataSet = { [K in TableName]: RecordMap[K][] };

export interface HistoryItem {
  id?: number;
  table: TableName;
  recordId: string;
  at: number;
  reason: 'edit' | 'delete' | 'conflict' | 'restore' | 'import';
  data: AnyRecord;
}

export type VersionKind = 'manual' | 'daily' | 'pre-import' | 'pre-restore' | 'pre-bulk-delete' | 'pre-encryption';

export interface VersionSummary {
  counts: Record<TableName, number>;
  totalMinutes: number;
  firstEntry: number | null;
  lastEntry: number | null;
}

export interface VersionMeta {
  id: string;
  createdAt: number;
  kind: VersionKind;
  name: string | null;
  deviceId: string;
  summary: VersionSummary;
  size: number;
}

export interface VersionRow extends VersionMeta {
  /** gzip 压缩后的 JSON（BackupFile） */
  blob: Uint8Array;
}

export interface BackupFile {
  app: 'lyubishchev-time';
  schemaVersion: number;
  exportedAt: number;
  deviceId: string;
  data: DataSet;
}

export type Lang = 'zh' | 'en';
export type ThemeMode = 'auto' | 'light' | 'dark';

export interface Settings {
  lang: Lang;
  theme: ThemeMode;
  weekStart: 0 | 1;
  allowOverlap: boolean;
  /** 计时结束时取整到的分钟数（1 表示不取整） */
  roundTo: 1 | 5 | 10 | 15;
  /** 少于该分钟数的计时将被丢弃 */
  minEntryMin: number;
  /** 空白检测阈值（分钟），0 关闭 */
  gapMin: number;
  /** 一天中参与空白检测的时间段 */
  dayStartHour: number;
  dayEndHour: number;
  reducedGlass: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  lang: 'zh',
  theme: 'auto',
  weekStart: 1,
  allowOverlap: false,
  roundTo: 1,
  minEntryMin: 1,
  gapMin: 15,
  dayStartHour: 7,
  dayEndHour: 23,
  reducedGlass: false
};

export type SyncProvider = 'cos' | 's3';

export interface SyncConfig {
  enabled: boolean;
  provider: SyncProvider;
  /** COS: bucket-appid，例如 notes-1250000000 */
  bucket: string;
  /** COS: ap-guangzhou 等 */
  region: string;
  /** 通用 S3: https://s3.example.com */
  endpoint: string;
  pathStyle: boolean;
  prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
  encrypt: boolean;
  autoSync: boolean;
}

export const DEFAULT_SYNC: SyncConfig = {
  enabled: false,
  provider: 'cos',
  bucket: '',
  region: 'ap-guangzhou',
  endpoint: '',
  pathStyle: false,
  prefix: 'lyubishchev',
  accessKeyId: '',
  secretAccessKey: '',
  encrypt: true,
  autoSync: true
};
