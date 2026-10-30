import zh from './zh';
import en from './en';
import type { Lang } from '../types';

const dicts: Record<Lang, Record<string, string>> = { zh, en };

let current = $state<Lang>('zh');

export const i18n = {
  get lang() {
    return current;
  },
  set lang(v: Lang) {
    current = v;
    if (typeof document !== 'undefined') document.documentElement.lang = v === 'zh' ? 'zh-CN' : 'en';
  }
};

/** 翻译：t('key', { n: 3 }) 会替换文案中的 {n} */
export function t(key: string, params?: Record<string, string | number>): string {
  let s = dicts[current][key] ?? dicts.zh[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

export function detectLang(): Lang {
  const l = (typeof navigator !== 'undefined' && navigator.language) || 'zh';
  return l.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}
