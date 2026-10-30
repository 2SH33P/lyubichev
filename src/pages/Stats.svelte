<script lang="ts">
  import { FileDown, ChevronRight, ChevronDown, TrendingUp, TrendingDown } from '@lucide/svelte';
  import PeriodNav from '../components/PeriodNav.svelte';
  import { periodLabel } from '../lib/period';
  import Donut from '../components/Donut.svelte';
  import StackedBars from '../components/StackedBars.svelte';
  import Heatmap from '../components/Heatmap.svelte';
  import DayBar from '../components/DayBar.svelte';
  import { app, findPlan, findReview } from '../lib/app.svelte';
  import { i18n, t } from '../lib/i18n/index.svelte';
  import { download } from '../lib/importExport';
  import { statsMarkdown } from '../lib/report';
  import { computeStats, estimateAccuracy, planProgress } from '../lib/stats';
  import { daysInRange, fmtDur, fmtHours, periodKeyOf, periodRange, shiftPeriod, startOfDay, DAY, HOUR } from '../lib/time';
  import type { PeriodType } from '../lib/types';
  import { router } from '../lib/router.svelte';

  type PT = 'day' | 'week' | 'month' | 'year';
  const initType: PT = (router.query.get('type') as PT) || 'week';
  let type = $state<PT>(initType);
  let key = $state(router.query.get('key') || periodKeyOf(initType, Date.now(), app.settings.weekStart));
  let expanded = $state(new Set<string>());
  let donutBy = $state<'category' | 'kind'>('category');

  const range = $derived(periodRange(type, key));
  const stats = $derived(computeStats(app.entries, app.idx, range, app.now));
  const prevStats = $derived(computeStats(app.entries, app.idx, periodRange(type, shiftPeriod(type, key, -1, app.settings.weekStart)), app.now));
  const elapsedDays = $derived(Math.max(1, Math.ceil((Math.min(range[1], startOfDay(app.now) + DAY) - range[0]) / DAY)));
  const plan = $derived(type === 'day' ? undefined : findPlan(type as PeriodType, key));
  const planRows = $derived(planProgress(plan, stats));
  const accuracy = $derived(estimateAccuracy(app.todos, app.todoActual, range));
  const delta = $derived(prevStats.workMs ? (stats.workMs - prevStats.workMs) / prevStats.workMs : null);

  const KIND_COLORS = { primary: 'var(--purple)', secondary: 'var(--orange-bright)', life: 'var(--green-bright)' };

  const trend = $derived.by(() => {
    if (type === 'day') return null;
    if (type === 'year') {
      const labels = Array.from({ length: 12 }, (_, m) => String(m + 1));
      const vals = { primary: Array(12).fill(0), secondary: Array(12).fill(0), life: Array(12).fill(0) };
      for (const [dk, v] of stats.byDay) {
        const m = Number(dk.slice(5, 7)) - 1;
        vals.primary[m] += v.primary;
        vals.secondary[m] += v.secondary;
        vals.life[m] += v.life;
      }
      return { labels, vals };
    }
    const days = daysInRange(range);
    return {
      labels: days.map((d) => (type === 'week' ? new Date(d).toLocaleDateString(i18n.lang === 'zh' ? 'zh-CN' : 'en-US', { weekday: 'short' }) : String(Number(d.slice(8))))),
      vals: {
        primary: days.map((d) => stats.byDay.get(d)?.primary || 0),
        secondary: days.map((d) => stats.byDay.get(d)?.secondary || 0),
        life: days.map((d) => stats.byDay.get(d)?.life || 0)
      }
    };
  });

  const donut = $derived(
    donutBy === 'kind'
      ? (['primary', 'secondary', 'life'] as const).map((k) => ({ value: stats.byKind[k], color: KIND_COLORS[k], label: t('kind.' + k) }))
      : app.idx
          .roots()
          .map((c) => ({ value: stats.byCategoryRollup.get(c.id) || 0, color: c.color, label: c.name }))
          .concat(
            [...stats.byCategory.entries()].filter(([id]) => !app.idx.get(id)).map(([id, v]) => ({ value: v, color: '#8e8e93', label: '?' + id.slice(0, 4) }))
          )
          .sort((a, b) => b.value - a.value)
  );
  const donutTotal = $derived(donut.reduce((s, x) => s + x.value, 0));

  const treeRows = $derived.by(() => {
    const out: { id: string; name: string; color: string; depth: number; ms: number; hasKids: boolean }[] = [];
    const walk = (parent: string | null, depth: number) => {
      const kids = parent ? app.idx.kids(parent) : app.idx.roots();
      for (const c of [...kids].sort((a, b) => (stats.byCategoryRollup.get(b.id) || 0) - (stats.byCategoryRollup.get(a.id) || 0))) {
        const ms = stats.byCategoryRollup.get(c.id) || 0;
        if (!ms) continue;
        const hasKids = app.idx.kids(c.id).some((k) => stats.byCategoryRollup.get(k.id));
        out.push({ id: c.id, name: c.name, color: c.color, depth, ms, hasKids });
        if (hasKids && expanded.has(c.id)) walk(c.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  });

  const tags = $derived([...stats.byTag.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12));
  const heat = $derived.by(() => {
    if (type !== 'year') return null;
    const m = new Map<string, number>();
    for (const [k, v] of stats.byDay) m.set(k, v.primary);
    return m;
  });
  const maxRow = $derived(Math.max(1, ...treeRows.filter((r) => r.depth === 0).map((r) => r.ms)));

  function toggle(id: string) {
    const s = new Set(expanded);
    s.has(id) ? s.delete(id) : s.add(id);
    expanded = s;
  }
  function exportMd() {
    const review = type !== 'day' ? findReview(type as PeriodType, key)?.text : undefined;
    const md = statsMarkdown({ title: `${t('stats.reportTitle')} · ${periodLabel(type, key)}`, stats, idx: app.idx, plan: planRows, review, lang: i18n.lang, t });
    download(`report-${type}-${key}.md`, md, 'text/markdown;charset=utf-8');
  }
  const pct = (ms: number, total: number) => (total ? Math.round((ms / total) * 100) : 0);
</script>

<div class="page">
  <header class="page-header">
    <div>
      <h1>{t('nav.stats')}</h1>
      <div class="subtitle">{t('stats.subtitle')}</div>
    </div>
    <button class="btn" onclick={exportMd}><FileDown size={18} />{t('stats.exportMd')}</button>
  </header>

  <PeriodNav bind:type bind:key />

  <div class="kpis">
    <div class="kpi glass">
      <span>{t('stats.total')}</span><b class="num">{fmtHours(stats.totalMs)}<small>h</small></b>
      <em>{t('stats.entriesDays', { n: stats.entryCount, d: stats.daysWithRecords })}</em>
    </div>
    <div class="kpi glass">
      <span>{t('stats.work')}</span><b class="num">{fmtHours(stats.workMs)}<small>h</small></b>
      {#if delta !== null}
        <em class:up={delta >= 0} class:down={delta < 0}>
          {#if delta >= 0}<TrendingUp size={13} />{:else}<TrendingDown size={13} />{/if}
          {Math.abs(Math.round(delta * 100))}% {t('stats.vsPrev')}
        </em>
      {:else}<em>&nbsp;</em>{/if}
    </div>
    <div class="kpi glass" style="--k:var(--purple)">
      <span>{t('kind.primary')}</span><b class="num k">{fmtHours(stats.primaryMs)}<small>h</small></b>
      <em>{t('stats.ofWork', { p: pct(stats.primaryMs, stats.workMs) })}</em>
    </div>
    <div class="kpi glass">
      <span>{type === 'day' ? t('kind.secondary') : t('stats.dailyWork')}</span>
      <b class="num">{type === 'day' ? fmtHours(stats.byKind.secondary) : fmtHours(stats.workMs / elapsedDays)}<small>h</small></b>
      <em>{type === 'day' ? '' : t('stats.dailyPrimary', { h: fmtHours(stats.primaryMs / elapsedDays) })}</em>
    </div>
  </div>

  <div class="cols two">
    <section class="card glass">
      <div class="card-title">
        {type === 'day' ? t('today.timeline') : t('stats.trend')}
        {#if type !== 'day'}<small>{t('stats.trendHint')}</small>{/if}
      </div>
      {#if type === 'day'}
        <DayBar day={range[0]} entries={app.entries.filter((e) => e.start < range[1] && (e.end ?? app.now) > range[0])} />
      {:else if trend}
        <StackedBars
          labels={trend.labels}
          series={[
            { name: t('kind.primary'), color: KIND_COLORS.primary, values: trend.vals.primary },
            { name: t('kind.secondary'), color: KIND_COLORS.secondary, values: trend.vals.secondary },
            { name: t('kind.life'), color: KIND_COLORS.life, values: trend.vals.life }
          ]}
        />
      {/if}
    </section>

    <section class="card glass">
      <div class="card-title">
        {t('stats.distribution')}
        <span class="seg">
          <button class:on={donutBy === 'category'} onclick={() => (donutBy = 'category')}>{t('common.category')}</button>
          <button class:on={donutBy === 'kind'} onclick={() => (donutBy = 'kind')}>{t('cat.kind')}</button>
        </span>
      </div>
      {#if !donutTotal}
        <div class="empty">{t('stats.noData')}</div>
      {:else}
        <div class="dist">
          <Donut segments={donut} size={168} thickness={20}>
            {#snippet center()}<div><div class="big num">{fmtHours(donutTotal)}h</div><div class="small muted">{t('stats.total')}</div></div>{/snippet}
          </Donut>
          <div class="legend">
            {#each donut.filter((d) => d.value) as d (d.label)}
              <div><i style="background:{d.color}"></i><span class="ellipsis">{d.label}</span><b class="num">{pct(d.value, donutTotal)}%</b></div>
            {/each}
          </div>
        </div>
      {/if}
    </section>
  </div>

  <div class="cols two" style="margin-top:16px">
    <section class="card glass">
      <div class="card-title">{t('stats.byCategory')}<small>{t('stats.byCategoryHint')}</small></div>
      {#if !treeRows.length}<div class="empty">{t('stats.noData')}</div>{/if}
      <div class="tree">
        {#each treeRows as r (r.id)}
          <button class="trow" style="--c:{r.color};padding-left:{r.depth * 20}px" onclick={() => r.hasKids && toggle(r.id)} aria-expanded={r.hasKids ? expanded.has(r.id) : undefined}>
            <span class="tw">{#if r.hasKids}{#if expanded.has(r.id)}<ChevronDown size={16} />{:else}<ChevronRight size={16} />{/if}{/if}</span>
            <span class="tname">
              <span class="tline"><span class="dot"></span><span class="ellipsis">{r.name}</span><span class="spacer"></span><b class="num">{fmtDur(r.ms, i18n.lang)}</b><span class="num faint pc">{pct(r.ms, stats.totalMs)}%</span></span>
              {#if r.depth === 0}<span class="bar"><i style="width:{(r.ms / maxRow) * 100}%"></i></span>{/if}
            </span>
          </button>
        {/each}
      </div>
    </section>

    <div class="stack">
      {#if planRows.length}
        <section class="card glass">
          <div class="card-title">{t('stats.plan')}<small>{t('stats.planHint')}</small></div>
          {#each planRows as p (p.categoryId)}
            {@const c = app.idx.get(p.categoryId)}
            <div class="prow">
              <div class="tline"><span class="dot" style="--c:{c?.color}"></span><span class="ellipsis">{app.idx.pathName(p.categoryId)}</span><span class="spacer"></span><span class="num small">{fmtHours(p.actualMs)} / {fmtHours(p.targetMs)}h</span><b class="num pc" class:ok={p.ratio >= 1}>{Math.round(p.ratio * 100)}%</b></div>
              <div class="bar"><i style="width:{Math.min(100, p.ratio * 100)}%;--c:{p.ratio >= 1 ? 'var(--green-bright)' : c?.color}"></i></div>
            </div>
          {/each}
        </section>
      {/if}

      {#if stats.outputs.length}
        <section class="card glass">
          <div class="card-title">{t('stats.outputs')}<small>{t('stats.outputsHint')}</small></div>
          <table class="tbl">
            <thead><tr><th>{t('common.category')}</th><th>{t('stats.output')}</th><th>{t('common.hours')}</th><th>{t('stats.perHour')}</th></tr></thead>
            <tbody>
              {#each stats.outputs as o (o.categoryId + o.unit)}
                <tr><td>{app.idx.pathName(o.categoryId)}</td><td class="num">{o.amount} {o.unit}</td><td class="num">{fmtHours(o.ms)}</td><td class="num"><b>{(o.amount / (o.ms / HOUR)).toFixed(1)}</b></td></tr>
              {/each}
            </tbody>
          </table>
        </section>
      {/if}

      {#if accuracy.rows.length}
        <section class="card glass">
          <div class="card-title">{t('stats.estimate')}<small>{t('stats.estimateHint')}</small></div>
          <div class="accuracy"><b class="num">{Math.round(accuracy.ratio * 100)}%</b><span class="muted small">{t('stats.estimateDesc', { n: accuracy.rows.length })}</span></div>
          {#each accuracy.rows.slice(0, 5) as r (r.todo.id)}
            <div class="tline small"><span class="ellipsis">{r.todo.title}</span><span class="spacer"></span><span class="num">{fmtHours(r.actualMs)} / {fmtHours(r.estimateMs)}h</span></div>
          {/each}
        </section>
      {/if}

      {#if tags.length}
        <section class="card glass">
          <div class="card-title">{t('stats.tags')}</div>
          <div class="tags">
            {#each tags as [tg, ms] (tg)}<span class="chip">#{tg} <b class="num">{fmtHours(ms)}h</b></span>{/each}
          </div>
        </section>
      {/if}
    </div>
  </div>

  {#if heat}
    <section class="card glass" style="margin-top:16px">
      <div class="card-title">{t('stats.heatmap')}<small>{t('stats.heatmapHint')}</small></div>
      <Heatmap year={Number(key)} values={heat} weekStart={app.settings.weekStart} />
    </section>
  {/if}
</div>

<style>
  .kpis {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
    margin-bottom: 16px;
  }
  .kpi {
    border-radius: var(--r-lg);
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .kpi span {
    font-size: 13px;
    color: var(--text-2);
    font-weight: 600;
  }
  .kpi b {
    font-size: 30px;
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.15;
  }
  .kpi b.k {
    color: var(--k);
  }
  .kpi small {
    font-size: 15px;
    font-weight: 600;
    margin-left: 2px;
    color: var(--text-2);
  }
  .kpi em {
    font-style: normal;
    font-size: 12.5px;
    color: var(--text-2);
    display: flex;
    align-items: center;
    gap: 3px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .kpi em.up { color: var(--green); }
  .kpi em.down { color: var(--red); }
  @media (max-width: 760px) {
    .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  .card-title .seg button {
    min-height: 28px;
    padding: 0 10px;
    font-size: 13px;
  }
  .dist {
    display: flex;
    align-items: center;
    gap: 22px;
    flex-wrap: wrap;
  }
  .big {
    font-size: 22px;
    font-weight: 700;
  }
  .legend {
    flex: 1;
    min-width: 150px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .legend div {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    min-width: 0;
  }
  .legend i {
    width: 10px;
    height: 10px;
    border-radius: 3px;
    flex: none;
  }
  .legend span {
    flex: 1;
    min-width: 0;
  }
  .tree {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .trow {
    display: flex;
    align-items: flex-start;
    gap: 4px;
    width: 100%;
    border: 0;
    background: none;
    color: inherit;
    text-align: left;
    padding: 8px 4px;
    border-radius: 10px;
    cursor: pointer;
  }
  .trow:hover {
    background: var(--fill);
  }
  .tw {
    width: 18px;
    flex: none;
    color: var(--text-3);
    padding-top: 1px;
  }
  .tname {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .tline {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    font-size: 15px;
  }
  .pc {
    width: 44px;
    text-align: right;
    font-size: 13px;
  }
  .pc.ok {
    color: var(--green);
  }
  .prow {
    margin-bottom: 14px;
  }
  .prow .bar {
    margin-top: 6px;
  }
  .tbl {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
  }
  .tbl th {
    text-align: left;
    font-size: 12px;
    color: var(--text-2);
    font-weight: 600;
    padding: 0 6px 6px;
  }
  .tbl td {
    padding: 8px 6px;
    border-top: 0.5px solid var(--hairline);
  }
  .tbl th:not(:first-child),
  .tbl td:not(:first-child) {
    text-align: right;
  }
  .accuracy {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin-bottom: 10px;
  }
  .accuracy b {
    font-size: 30px;
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
</style>
