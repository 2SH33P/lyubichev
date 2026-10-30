import { periodRange } from './time';
import type { Review } from './types';

/** 已锁定（复盘完成）的时间段 */
export function lockedRanges(reviews: Review[]): [number, number][] {
  return reviews.filter((r) => r.locked && !r.deleted).map((r) => periodRange(r.periodType, r.periodKey));
}

export function isLockedAt(t: number, ranges: [number, number][]): boolean {
  return ranges.some(([a, b]) => t >= a && t < b);
}
