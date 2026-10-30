import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { parseCsv, guessMapping, buildEntriesFromCsv, parseDuration, parseDateTime, entriesToCsv } from '../src/lib/csv';
import { CategoryIndex, computeStats, findOverlaps, cutEntry } from '../src/lib/stats';
import { selectPrunable } from '../src/lib/versions';
import { HOUR, MIN } from '../src/lib/time';
import { cat, entry } from './helpers';

const t = (s: string) => new Date(s).getTime();
const DAY = 24 * HOUR;

describe('csv', () => {
  it('parses quoted fields and detects delimiter', () => {
    expect(parseCsv('a,b\n"x, y","he said ""hi"""\n')).toEqual([['a', 'b'], ['x, y', 'he said "hi"']]);
    expect(parseCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('parses durations', () => {
    expect(parseDuration('90')).toBe(90 * MIN);
    expect(parseDuration('1:30')).toBe(90 * MIN);
    expect(parseDuration('1h 20m')).toBe(80 * MIN);
    expect(parseDuration('2小时15分')).toBe(135 * MIN);
    expect(parseDuration('abc')).toBeNull();
    expect(parseDateTime('2026-03-04 09:15')).toBe(t('2026-03-04T09:15'));
  });
  it('imports Chinese headers with date + time + duration, creating category paths and skipping duplicates', () => {
    const rows = parseCsv('日期,开始时间,时长,分类,备注\n2026-03-04,09:00,90,工作/写作,第一章\n2026-03-04,23:30,60,睡眠,\n2026-03-05,09:00,,工作/写作,缺时长\n');
    const mapping = guessMapping(rows[0]);
    expect(mapping.date).toBe(0);
    expect(mapping.category).toBe(3);
    const existing = [cat('w', '工作')];
    const r = buildEntriesFromCsv(rows, mapping, existing, [], 'dev');
    expect(r.entries).toHaveLength(2);
    expect(r.errors.map((e) => e.row)).toEqual([4]);
    const writing = r.newCategories.find((c) => c.name === '写作')!;
    expect(writing.parentId).toBe('w');
    expect(r.entries[0].categoryId).toBe(writing.id);
    expect(r.entries[1].end! - r.entries[1].start).toBe(HOUR); // crosses midnight
    const again = buildEntriesFromCsv(rows, mapping, [...existing, ...r.newCategories], r.entries, 'dev');
    expect(again.entries).toHaveLength(0);
    expect(again.duplicates).toBe(2);
  });
  it('round-trips export headers', () => {
    const cats = [cat('a', 'A')];
    const csv = entriesToCsv([entry('e', 'a', t('2026-01-01T09:00'), t('2026-01-01T10:00'), { note: 'x,y' })], new CategoryIndex(cats), new Map());
    const rows = parseCsv(csv.replace(/^\uFEFF/, ''));
    expect(rows[1]).toContain('x,y');
    const r = buildEntriesFromCsv(rows, guessMapping(rows[0]), cats, [], 'dev');
    expect(r.errors).toEqual([]);
    expect(r.entries[0].start).toBe(t('2026-01-01T09:00'));
    expect(r.entries[0].end).toBe(t('2026-01-01T10:00'));
  });
});

describe('stats', () => {
  const cats = [
    cat('p', 'Core', { kind: 'primary' }),
    cat('p1', 'Writing', { kind: 'primary', parentId: 'p' }),
    cat('s', 'Mail', { kind: 'secondary' }),
    cat('l', 'Sleep', { kind: 'life', countAsWork: false })
  ];
  const idx = new CategoryIndex(cats);
  it('rolls up children, clips to range and splits by kind', () => {
    const es = [
      entry('1', 'p1', t('2026-01-01T09:00'), t('2026-01-01T11:00')),
      entry('2', 's', t('2026-01-01T11:00'), t('2026-01-01T11:30')),
      entry('3', 'l', t('2025-12-31T23:00'), t('2026-01-01T07:00'))
    ];
    const st = computeStats(es, idx, [t('2026-01-01T00:00'), t('2026-01-02T00:00')]);
    expect(st.byCategoryRollup.get('p')).toBe(2 * HOUR);
    expect(st.byKind.primary).toBe(2 * HOUR);
    expect(st.byKind.life).toBe(7 * HOUR);
    expect(st.workMs).toBe(2.5 * HOUR);
    expect(st.primaryMs).toBe(2 * HOUR);
  });
  it('detects overlaps and cuts entries', () => {
    const a = entry('a', 'p1', t('2026-01-01T09:00'), t('2026-01-01T11:00'));
    expect(findOverlaps([a], { start: t('2026-01-01T10:00'), end: t('2026-01-01T12:00') })).toHaveLength(1);
    expect(findOverlaps([a], { start: t('2026-01-01T11:00'), end: t('2026-01-01T12:00') })).toHaveLength(0);
    const parts = cutEntry(a, [t('2026-01-01T09:30'), t('2026-01-01T10:00')]);
    expect(parts.map((p) => [p.start, p.end])).toEqual([
      [t('2026-01-01T09:00'), t('2026-01-01T09:30')],
      [t('2026-01-01T10:00'), t('2026-01-01T11:00')]
    ]);
  });
});

describe('version retention', () => {
  it('keeps manual forever, all recent, one per week, then one per month', () => {
    const now = t('2026-06-30T12:00');
    const rows = [
      { id: 'm-old', createdAt: now - 400 * DAY, kind: 'manual' as const },
      ...Array.from({ length: 200 }, (_, i) => ({ id: 'd' + i, createdAt: now - i * DAY, kind: 'daily' as const }))
    ];
    const remove = new Set(selectPrunable(rows, now));
    expect(remove.has('m-old')).toBe(false);
    for (let i = 0; i < 7; i++) expect(remove.has('d' + i)).toBe(false);
    const kept = rows.filter((r) => !remove.has(r.id));
    const weekly = kept.filter((r) => now - r.createdAt >= 7 * DAY && now - r.createdAt < 84 * DAY);
    expect(weekly.length).toBeGreaterThanOrEqual(10);
    expect(weekly.length).toBeLessThanOrEqual(12);
    const monthly = kept.filter((r) => now - r.createdAt >= 84 * DAY && r.kind === 'daily');
    expect(monthly.length).toBeLessThanOrEqual(5);
  });
});
