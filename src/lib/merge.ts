import type { Base } from './types';

export type MergeDecision = 'take' | 'keep' | 'same';

/** 记录级"最后写入者胜"：比较混合逻辑时钟 */
export function decide(local: Base | undefined, remote: Base): MergeDecision {
  if (!local) return 'take';
  if (remote.hlc === local.hlc) return 'same';
  return remote.hlc > local.hlc ? 'take' : 'keep';
}

/** 合并两组记录（纯函数，便于测试） */
export function mergeRecords<T extends Base>(local: T[], remote: T[]): T[] {
  const map = new Map(local.map((r) => [r.id, r]));
  for (const r of remote) {
    if (decide(map.get(r.id), r) === 'take') map.set(r.id, r);
  }
  return [...map.values()];
}
