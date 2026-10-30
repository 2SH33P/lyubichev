import 'fake-indexeddb/auto';
import { AppDB } from '../src/lib/db';
import { Repo } from '../src/lib/repo';
import { SyncEngine, emptyState, type SyncState } from '../src/lib/sync/engine';
import type { ObjectStorage } from '../src/lib/sync/storage';
import type { Category, Entry } from '../src/lib/types';

let n = 0;
export async function makeDevice(name: string, storage: ObjectStorage, threshold = 50) {
  const db = new AppDB(`test-${name}-${n++}-${Math.random()}`);
  await db.open();
  const repo = await Repo.open(db, name);
  const keys = new Map<string, CryptoKey | null>();
  let state: SyncState = emptyState();
  const engine = new SyncEngine({
    repo,
    storage,
    prefix: 'test',
    compactThreshold: threshold,
    keys: { get: async (e) => keys.get(e) ?? null, set: async (e, k) => void keys.set(e, k) },
    state: { load: async () => structuredClone(state), save: async (s) => void (state = structuredClone(s)) }
  });
  return { db, repo, engine, keys, getState: () => state };
}

export function cat(id: string, name: string, extra: Partial<Category> = {}): Category {
  return { id, name, parentId: null, kind: 'primary', color: '#f00', countAsWork: true, order: 0, archived: false, createdAt: 0, updatedAt: 0, hlc: '', deviceId: '', ...extra };
}

export function entry(id: string, categoryId: string, start: number, end: number | null, extra: Partial<Entry> = {}): Entry {
  return { id, categoryId, start, end, pauses: [], note: '', tags: [], output: null, source: 'manual', todoId: null, createdAt: 0, updatedAt: 0, hlc: '', deviceId: '', ...extra };
}
