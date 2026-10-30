import type { CategoryIndex, PlanRow, RangeStats } from './stats';
import { fmtDur, fmtHours } from './time';
import type { Lang } from './types';

export function statsMarkdown(opts: {
  title: string;
  stats: RangeStats;
  idx: CategoryIndex;
  plan: PlanRow[];
  review?: string;
  lang: Lang;
  t: (k: string, p?: Record<string, string | number>) => string;
}): string {
  const { stats, idx, t, lang } = opts;
  const pct = (ms: number) => (stats.totalMs ? ((ms / stats.totalMs) * 100).toFixed(1) + '%' : '-');
  const lines: string[] = [`# ${opts.title}`, ''];
  lines.push(`- ${t('stats.total')}: **${fmtDur(stats.totalMs, lang)}**`);
  lines.push(`- ${t('stats.work')}: **${fmtDur(stats.workMs, lang)}**`);
  lines.push(`- ${t('kind.primary')}: **${fmtDur(stats.primaryMs, lang)}** (${pct(stats.primaryMs)})`);
  lines.push(`- ${t('kind.secondary')}: ${fmtDur(stats.byKind.secondary, lang)}`);
  lines.push(`- ${t('kind.life')}: ${fmtDur(stats.byKind.life, lang)}`);
  lines.push(`- ${t('stats.days')}: ${stats.daysWithRecords} · ${t('stats.entries')}: ${stats.entryCount}`, '');

  lines.push(`## ${t('stats.byCategory')}`, '', `| ${t('common.category')} | ${t('common.hours')} | % |`, '| --- | ---: | ---: |');
  for (const { cat, depth } of idx.flatten(true)) {
    const ms = stats.byCategoryRollup.get(cat.id) || 0;
    if (!ms) continue;
    lines.push(`| ${'　'.repeat(depth)}${cat.name} | ${fmtHours(ms)} | ${pct(ms)} |`);
  }
  lines.push('');
  if (opts.plan.length) {
    lines.push(`## ${t('stats.plan')}`, '', `| ${t('common.category')} | ${t('plan.target')} | ${t('plan.actual')} | % |`, '| --- | ---: | ---: | ---: |');
    for (const r of opts.plan) lines.push(`| ${idx.pathName(r.categoryId)} | ${fmtHours(r.targetMs)} | ${fmtHours(r.actualMs)} | ${(r.ratio * 100).toFixed(0)}% |`);
    lines.push('');
  }
  if (stats.outputs.length) {
    lines.push(`## ${t('stats.outputs')}`, '', `| ${t('common.category')} | ${t('stats.output')} | ${t('common.hours')} | ${t('stats.perHour')} |`, '| --- | ---: | ---: | ---: |');
    for (const o of stats.outputs) lines.push(`| ${idx.pathName(o.categoryId)} | ${o.amount} ${o.unit} | ${fmtHours(o.ms)} | ${(o.amount / (o.ms / 3_600_000)).toFixed(1)} |`);
    lines.push('');
  }
  if (opts.review?.trim()) lines.push(`## ${t('review.title')}`, '', opts.review.trim(), '');
  return lines.join('\n');
}
