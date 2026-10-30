/**
 * 混合逻辑时钟（Hybrid Logical Clock）。
 * 格式：{13 位毫秒}-{4 位 36 进制计数}-{设备 ID}，字符串比较即可得出先后。
 */
export interface HlcState {
  ms: number;
  counter: number;
}

export function formatHlc(ms: number, counter: number, deviceId: string): string {
  return `${String(ms).padStart(13, '0')}-${counter.toString(36).padStart(4, '0')}-${deviceId}`;
}

export function parseHlc(h: string): { ms: number; counter: number; deviceId: string } {
  const [ms, c, ...rest] = h.split('-');
  return { ms: Number(ms), counter: parseInt(c, 36), deviceId: rest.join('-') };
}

export class Hlc {
  state: HlcState;
  constructor(public deviceId: string, state?: HlcState, private now: () => number = Date.now) {
    this.state = state ?? { ms: 0, counter: 0 };
  }
  /** 生成一个新的本地时间戳 */
  tick(): string {
    const pt = this.now();
    if (pt > this.state.ms) {
      this.state = { ms: pt, counter: 0 };
    } else {
      this.state = { ms: this.state.ms, counter: this.state.counter + 1 };
    }
    return formatHlc(this.state.ms, this.state.counter, this.deviceId);
  }
  /** 收到远端时间戳后推进本地时钟 */
  receive(remote: string) {
    const r = parseHlc(remote);
    if (!Number.isFinite(r.ms)) return;
    const pt = this.now();
    const ms = Math.max(pt, this.state.ms, r.ms);
    let counter = 0;
    if (ms === this.state.ms && ms === r.ms) counter = Math.max(this.state.counter, r.counter) + 1;
    else if (ms === this.state.ms) counter = this.state.counter + 1;
    else if (ms === r.ms) counter = r.counter + 1;
    this.state = { ms, counter };
  }
}

/** 默认数据使用的最小时间戳，任何真实修改都会覆盖它 */
export const ZERO_HLC = formatHlc(0, 0, 'seed');
