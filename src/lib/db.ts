import Dexie, { type Table } from 'dexie';
import type { Category, Entry, HistoryItem, Plan, Review, TableName, Todo, VersionRow } from './types';

export interface OutboxItem {
  key: string; // `${table}:${id}`
  table: TableName;
  id: string;
}

export interface KvItem {
  key: string;
  value: unknown;
}

export class AppDB extends Dexie {
  categories!: Table<Category, string>;
  entries!: Table<Entry, string>;
  todos!: Table<Todo, string>;
  plans!: Table<Plan, string>;
  reviews!: Table<Review, string>;
  history!: Table<HistoryItem, number>;
  versions!: Table<VersionRow, string>;
  outbox!: Table<OutboxItem, string>;
  kv!: Table<KvItem, string>;

  constructor(name = 'lyubishchev-time') {
    super(name);
    this.version(1).stores({
      categories: '&id, parentId, updatedAt',
      entries: '&id, start, categoryId, todoId, updatedAt',
      todos: '&id, status, due, updatedAt',
      plans: '&id, [periodType+periodKey]',
      reviews: '&id, [periodType+periodKey]',
      history: '++id, [table+recordId], at',
      versions: '&id, createdAt, kind',
      outbox: '&key',
      kv: '&key'
    });
  }

  async getKv<T>(key: string, fallback: T): Promise<T> {
    const row = await this.kv.get(key);
    return row === undefined ? fallback : (row.value as T);
  }

  async setKv(key: string, value: unknown) {
    await this.kv.put({ key, value });
  }

  table_(name: TableName): Table<any, string> {
    return this[name] as Table<any, string>;
  }
}
