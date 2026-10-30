import { describe, expect, it } from 'vitest';
import { makeDevice, cat, entry } from './helpers';
import { MemoryStorage } from '../src/lib/sync/storage';
import { NeedPasswordError, WrongPasswordError } from '../src/lib/sync/engine';

const live = async (d: any, table: string) => (await d.db.table_(table).toArray()).filter((r: any) => !r.deleted);

describe('sync engine', () => {
  it('syncs creates, edits and deletes between two devices', async () => {
    const s = new MemoryStorage();
    const A = await makeDevice('devA', s);
    const B = await makeDevice('devB', s);
    await A.engine.connect({ encrypt: false });
    await A.repo.put('categories', [cat('c1', 'Writing')]);
    await A.repo.put('entries', [entry('e1', 'c1', 1000, 2000)]);
    await A.engine.sync();
    await B.engine.connect({ encrypt: false });
    await B.engine.sync();
    expect((await live(B, 'entries')).map((e: any) => e.id)).toEqual(['e1']);

    // B 编辑，A 删除另一个
    const [e1] = await live(B, 'entries');
    await B.repo.put('entries', [{ ...e1, note: 'from B' }]);
    await B.engine.sync();
    await A.engine.sync();
    expect((await live(A, 'entries'))[0].note).toBe('from B');

    await A.repo.remove('entries', ['e1']);
    await A.engine.sync();
    await B.engine.sync();
    expect(await live(B, 'entries')).toHaveLength(0);
    expect(await B.db.outbox.count()).toBe(0);
  });

  it('resolves concurrent edits with LWW and keeps loser in history', async () => {
    const s = new MemoryStorage();
    const A = await makeDevice('devA', s);
    const B = await makeDevice('devB', s);
    await A.engine.connect({ encrypt: false });
    await A.repo.put('entries', [entry('e1', 'c1', 1000, 2000)]);
    await A.engine.sync();
    await B.engine.sync();
    const [a1] = await live(A, 'entries');
    const [b1] = await live(B, 'entries');
    await A.repo.put('entries', [{ ...a1, note: 'A' }]);
    await new Promise((r) => setTimeout(r, 5));
    await B.repo.put('entries', [{ ...b1, note: 'B' }]);
    await A.engine.sync();
    const rep = await B.engine.sync();
    await A.engine.sync();
    expect((await live(A, 'entries'))[0].note).toBe('B');
    expect((await live(B, 'entries'))[0].note).toBe('B');
    const hist = await A.repo.historyOf('entries', 'e1');
    expect(hist.some((h) => (h.data as any).note === 'A')).toBe(true);
    expect(rep.conflicts).toBe(0); // B 的修改更新，B 侧不算冲突
  });

  it('compacts into snapshots and bootstraps a new device from them', async () => {
    const s = new MemoryStorage();
    const A = await makeDevice('devA', s, 3);
    await A.engine.connect({ encrypt: false });
    for (let i = 0; i < 6; i++) {
      await A.repo.put('entries', [entry(`e${i}`, 'c1', i * 1000, i * 1000 + 500)]);
      await A.engine.sync();
    }
    const snaps = [...s.objects.keys()].filter((k) => k.includes('/snapshots/'));
    expect(snaps.length).toBeGreaterThan(0);
    const C = await makeDevice('devC', s);
    const rep = await C.engine.sync();
    expect(rep.snapshotApplied).toBe(true);
    expect(await live(C, 'entries')).toHaveLength(6);
  });

  it('encrypts data and requires the password on another device', async () => {
    const s = new MemoryStorage();
    const A = await makeDevice('devA', s);
    await A.engine.connect({ encrypt: true, password: 'secret' });
    await A.repo.put('entries', [entry('e1', 'c1', 1000, 2000, { note: 'TOP-SECRET-NOTE' })]);
    await A.engine.sync();
    const allBytes = [...s.objects.values()].map((b) => new TextDecoder('latin1').decode(b)).join('');
    expect(allBytes.includes('TOP-SECRET-NOTE')).toBe(false);

    const B = await makeDevice('devB', s);
    await expect(B.engine.sync()).rejects.toBeInstanceOf(NeedPasswordError);
    await expect(B.engine.unlock('wrong')).rejects.toBeInstanceOf(WrongPasswordError);
    await B.engine.unlock('secret');
    await B.engine.sync();
    expect((await live(B, 'entries'))[0].note).toBe('TOP-SECRET-NOTE');
  });

  it('switches encryption off and other devices follow the new epoch', async () => {
    const s = new MemoryStorage();
    const A = await makeDevice('devA', s);
    const B = await makeDevice('devB', s);
    await A.engine.connect({ encrypt: true, password: 'pw' });
    await A.repo.put('entries', [entry('e1', 'c1', 1000, 2000)]);
    await A.engine.sync();
    await B.engine.unlock('pw');
    await B.engine.sync();
    // B 在 A 切换前有一条未被 A 看到的修改
    await B.repo.put('entries', [entry('e2', 'c1', 3000, 4000)]);
    await B.engine.sync();
    await A.engine.reencrypt(false);
    const meta = await A.engine.getMeta();
    expect(meta!.encrypted).toBe(false);
    await B.engine.sync();
    await A.engine.sync();
    expect((await live(A, 'entries')).map((e: any) => e.id).sort()).toEqual(['e1', 'e2']);
    expect((await live(B, 'entries')).map((e: any) => e.id).sort()).toEqual(['e1', 'e2']);
  });

  it('uploads and lists remote versions', async () => {
    const s = new MemoryStorage();
    const A = await makeDevice('devA', s);
    await A.engine.connect({ encrypt: true, password: 'pw' });
    const vm = { id: 'v1', createdAt: 123, kind: 'manual' as const, name: '十月复盘', deviceId: 'devA', summary: { counts: { categories: 0, entries: 1, todos: 0, plans: 0, reviews: 0 }, totalMinutes: 5, firstEntry: null, lastEntry: null }, size: 10 };
    await A.engine.uploadVersion(vm, { hello: 'world' });
    const list = await A.engine.listRemoteVersions();
    expect(list[0].meta.name).toBe('十月复盘');
    expect(await A.engine.downloadVersion(list[0].key)).toEqual({ hello: 'world' });
  });
});
