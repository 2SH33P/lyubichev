<script lang="ts">
  import { Lock, LockOpen, FileDown } from '@lucide/svelte';
  import PeriodNav from '../components/PeriodNav.svelte';
  import { app, findPlan, findReview, saveReview } from '../lib/app.svelte';
  import { i18n, t } from '../lib/i18n/index.svelte';
  import { download } from '../lib/importExport';
  import { periodLabel } from '../lib/period';
  import { statsMarkdown } from '../lib/report';
  import { computeStats, gapsForDay, planProgress } from '../lib/stats';
  import { daysInRange, fmtDur, fmtHours, parseDayKey, periodKeyOf, periodRange, shiftPeriod } from '../lib/time';
  import type { PeriodType } from '../lib/types';
  import { confirmDialog, report, toast } from '../lib/ui.svelte';

  let type = $state<'day' | 'week' | 'month' | 'year'>('month');
  let key = $state(periodKeyOf('month', Date.now()));
  const pt = $derived(type as PeriodType);
  const range = $derived(periodRange(type, key));
  const review = $derived(findReview(pt, key));
  const stats = $derived(computeStats(app.entries, app.idx, range, app.now));
  const prev = $derived(computeStats(app.entries, app.idx, periodRange(type, shiftPeriod(type, key, -1, app.settings.weekStart)), app.now));
  const plan = $derived(planProgress(findPlan(pt, key), stats));
  const top = $derived(
    app.idx
      .flatten()
      .filter((x) => x.depth > 0 || !app.idx.kids(x.cat.id).length)
      .map((x) => ({ c: x.cat, ms: stats.byCategoryRollup.get(x.cat.id) || 0 }))
      .filter((x) => x.ms)
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 5)
  );
  const untracked = $derived(
    type === 'year' ? 0 : daysInRange(range).filter((d) => parseDayKey(d) <= app.now).reduce((s, d) => s + gapsForDay(app.entries, parseDayKey(d), app.settings, app.now).reduce((x, [a, b]) => x + b - a, 0), 0)
  );
  const past = $derived(app.reviews.filter((r) => r.text.trim() || r.locked).sort((a, b) => b.periodKey.localeCompare(a.periodKey)).slice(0, 20));

  let text = $state('');
  let timer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    text = review?.text ?? '';
  });

  function onInput() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, 800);
  }
  async function save() {
    if (text === (review?.text ?? '')) return;
    try {
      await saveReview(pt, key, { text });
    } catch (e) {
      report(e);
    }
  }
  async function toggleLock() {
    if (!review?.locked) {
      if (!(await confirmDialog({ title: t('review.lockConfirm'), message: t('review.lockHint'), okText: t('review.lock') }))) return;
      await saveReview(pt, key, { locked: true, text, statsSnapshot: { totalMs: stats.totalMs, workMs: stats.workMs, primaryMs: stats.primaryMs, byKind: stats.byKind, byCategory: Object.fromEntries(stats.byCategoryRollup) } });
      toast(t('review.locked'), 'success');
    } else {
      if (!(await confirmDialog({ title: t('review.unlockConfirm'), okText: t('review.unlock') }))) return;
      await saveReview(pt, key, { locked: false });
    }
  }
  function exportMd() {
    download(`review-${type}-${key}.md`, statsMarkdown({ title: `${t('review.title')} · ${periodLabel(type, key)}`, stats, idx: app.idx, plan, review: text, lang: i18n.lang, t }), 'text/markdown;charset=utf-8');
  }
  const diff = (a: number, b: number) => (b ? `${a >= b ? '+' : ''}${Math.round(((a - b) / b) * 100)}%` : '—');
</script>

<div class="page narrow">
  <header class="page-header">
    <div>
      <h1>{t('nav.reviews')}</h1>
      <div class="subtitle">{t('review.subtitle')}</div>
    </div>
    <div class="toolbar">
      <button class="btn" onclick={exportMd}><FileDown size={17} />{t('stats.exportMd')}</button>
      <button class="btn" class:primary={!review?.locked} onclick={toggleLock}>
        {#if review?.locked}<LockOpen size={17} />{t('review.unlock')}{:else}<Lock size={17} />{t('review.lock')}{/if}
      </button>
    </div>
  </header>

  <PeriodNav bind:type bind:key types={['week', 'month', 'year']} />

  {#if review?.locked}<div class="locked glass-thin"><Lock size={16} /> {t('review.lockedBanner')}</div>{/if}

  <div class="cols two">
    <section class="card glass">
      <div class="card-title">{t('review.auto')}</div>
      <table class="tbl">
        <thead><tr><th></th><th>{t('review.thisPeriod')}</th><th>{t('review.prevPeriod')}</th><th>Δ</th></tr></thead>
        <tbody>
          <tr><td>{t('stats.total')}</td><td class="num">{fmtHours(stats.totalMs)}h</td><td class="num">{fmtHours(prev.totalMs)}h</td><td class="num">{diff(stats.totalMs, prev.totalMs)}</td></tr>
          <tr><td>{t('stats.work')}</td><td class="num">{fmtHours(stats.workMs)}h</td><td class="num">{fmtHours(prev.workMs)}h</td><td class="num">{diff(stats.workMs, prev.workMs)}</td></tr>
          <tr><td>{t('kind.primary')}</td><td class="num"><b>{fmtHours(stats.primaryMs)}h</b></td><td class="num">{fmtHours(prev.primaryMs)}h</td><td class="num">{diff(stats.primaryMs, prev.primaryMs)}</td></tr>
          <tr><td>{t('kind.secondary')}</td><td class="num">{fmtHours(stats.byKind.secondary)}h</td><td class="num">{fmtHours(prev.byKind.secondary)}h</td><td class="num">{diff(stats.byKind.secondary, prev.byKind.secondary)}</td></tr>
          <tr><td>{t('stats.days')}</td><td class="num">{stats.daysWithRecords}</td><td class="num">{prev.daysWithRecords}</td><td></td></tr>
          {#if untracked}<tr><td>{t('today.untracked')}</td><td class="num">{fmtHours(untracked)}h</td><td></td><td></td></tr>{/if}
        </tbody>
      </table>
      {#if top.length}
        <div class="label" style="margin:16px 0 8px">{t('review.top')}</div>
        {#each top as x (x.c.id)}
          <div class="trow"><span class="dot" style="--c:{x.c.color}"></span><span class="ellipsis">{app.idx.pathName(x.c.id)}</span><span class="spacer"></span><b class="num">{fmtDur(x.ms, i18n.lang)}</b></div>
        {/each}
      {/if}
      {#if plan.length}
        <div class="label" style="margin:16px 0 8px">{t('stats.plan')}</div>
        {#each plan as p (p.categoryId)}
          <div class="trow"><span class="ellipsis">{app.idx.pathName(p.categoryId)}</span><span class="spacer"></span><span class="num small">{fmtHours(p.actualMs)}/{fmtHours(p.targetMs)}h</span><b class="num" class:ok={p.ratio >= 1}>{Math.round(p.ratio * 100)}%</b></div>
        {/each}
      {/if}
    </section>

    <section class="card glass">
      <div class="card-title">{t('review.title')}<small>{t('review.autosave')}</small></div>
      <textarea class="input text" bind:value={text} oninput={onInput} onblur={save} placeholder={t('review.placeholder')}></textarea>
    </section>
  </div>

  {#if past.length}
    <div class="list-header">{t('review.past')}</div>
    <div class="list glass">
      {#each past as r (r.id)}
        <button class="row row-btn" onclick={() => ((type = r.periodType), (key = r.periodKey))}>
          <span class="grow">
            <b>{periodLabel(r.periodType, r.periodKey)}</b>
            <span class="sub ellipsis" style="display:block">{r.text.split('\n')[0] || '—'}</span>
          </span>
          {#if r.locked}<Lock size={15} class="faint" />{/if}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .narrow {
    max-width: 1040px;
  }
  .locked {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    border-radius: var(--r-md);
    margin-bottom: 16px;
    color: var(--orange);
    font-weight: 550;
    font-size: 14px;
  }
  .tbl {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
  }
  .tbl th {
    font-size: 12px;
    color: var(--text-2);
    font-weight: 600;
    text-align: right;
    padding: 0 6px 6px;
  }
  .tbl td {
    padding: 8px 6px;
    border-top: 0.5px solid var(--hairline);
    text-align: right;
  }
  .tbl td:first-child {
    text-align: left;
    color: var(--text-2);
  }
  .trow {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 0;
    font-size: 14px;
    min-width: 0;
  }
  .trow .ok {
    color: var(--green);
  }
  .text {
    min-height: 320px;
    resize: vertical;
    line-height: 1.6;
  }
</style>
