import { describe, expect, it } from 'vitest';
import { activeIntervals, netMs, splitByDay, unionIntervals, subtractIntervals, periodRange, shiftPeriod, periodKeyOf, roundEnd, MIN, HOUR } from '../src/lib/time';

const t = (s: string) => new Date(s).getTime();

describe('time', () => {
  it('net time excludes pauses', () => {
    const e = { start: t('2026-01-01T09:00'), end: t('2026-01-01T11:00'), pauses: [{ start: t('2026-01-01T10:00'), end: t('2026-01-01T10:20') }] };
    expect(netMs(e)).toBe(100 * MIN);
    expect(activeIntervals(e)).toHaveLength(2);
  });
  it('running entry with open pause', () => {
    const now = t('2026-01-01T10:30');
    const e = { start: t('2026-01-01T10:00'), end: null, pauses: [{ start: t('2026-01-01T10:10'), end: null }] };
    expect(netMs(e, now)).toBe(10 * MIN);
  });
  it('splits across midnight', () => {
    const m = splitByDay([[t('2026-01-01T23:00'), t('2026-01-02T01:30')]]);
    expect(m.get('2026-01-01')).toBe(HOUR);
    expect(m.get('2026-01-02')).toBe(1.5 * HOUR);
  });
  it('union and subtract', () => {
    expect(unionIntervals([[0, 5], [3, 8], [10, 12]])).toEqual([[0, 8], [10, 12]]);
    expect(subtractIntervals([[0, 10]], [[2, 4], [6, 7]])).toEqual([[0, 2], [4, 6], [7, 10]]);
  });
  it('periods', () => {
    const [a, b] = periodRange('month', '2026-02');
    expect(b - a).toBe(28 * 24 * HOUR);
    expect(shiftPeriod('month', '2026-12', 1)).toBe('2027-01');
    expect(periodKeyOf('week', t('2026-10-29T12:00'), 1)).toBe('2026-10-26');
    expect(shiftPeriod('week', '2026-10-26', -1)).toBe('2026-10-19');
  });
  it('rounds end time', () => {
    const s = t('2026-01-01T09:00');
    const end = roundEnd({ start: s, pauses: [] }, s + 23 * MIN, 15);
    expect(end - s).toBe(30 * MIN);
  });
});
