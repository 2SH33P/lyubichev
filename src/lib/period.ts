import { i18n } from './i18n/index.svelte';
import { dayKey, periodRange } from './time';

export function periodLabel(tp: 'day' | 'week' | 'month' | 'year', k: string, lang = i18n.lang): string {
  const [a, b] = periodRange(tp, k);
  const loc = lang === 'zh' ? 'zh-CN' : 'en-US';
  if (tp === 'day') return new Date(a).toLocaleDateString(loc, { year: 'numeric', month: 'short', day: 'numeric', weekday: 'short' });
  if (tp === 'week') return `${dayKey(a)} – ${dayKey(b - 1).slice(5)}`;
  if (tp === 'month') return new Date(a).toLocaleDateString(loc, { year: 'numeric', month: 'long' });
  return k;
}
