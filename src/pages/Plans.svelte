<script lang="ts">
  import { Copy } from '@lucide/svelte';
  import PeriodNav from '../components/PeriodNav.svelte';
  import { app, findPlan, savePlan } from '../lib/app.svelte';
  import { i18n, t } from '../lib/i18n/index.svelte';
  import { computeStats } from '../lib/stats';
  import { fmtDur, fmtHours, periodKeyOf, periodRange, shiftPeriod, MIN } from '../lib/time';
  import type { PeriodType } from '../lib/types';
  import { report, toast } from '../lib/ui.svelte';

  let type = $state<'day' | 'week' | 'month' | 'year'>('month');
  let key = $state(periodKeyOf('month', Date.now()));
  const pt = $derived(type as PeriodType);
  const plan = $derived(findPlan(pt, key));
  const stats = $derived(computeStats(app.entries, app.idx, periodRange(type, key), app.now));
  const targets = $derived(new Map((plan?.targets ?? []).map((x) => [x.categoryId, x.minutes])));
  const rows = $derived(app.idx.flatten());
  const totalTarget = $derived([...targets.entries()].filter(([id]) => !app.idx.get(id)?.parentId).reduce((s, [, m]) => s + m, 0));

  async function setTarget(catId: string, hours: string) {
    const minutes = Math.round((parseFloat(hours) || 0) * 60);
    const next = new Map(targets);
    if (minutes > 0) next.set(catId, minutes);
    else next.delete(catId);
    try {
      await savePlan(pt, key, { targets: [...next.entries()].map(([categoryId, m]) => ({ categoryId, minutes: m })) });
    } catch (e) {
      report(e);
    }
  }
  async function copyPrev() {
    const prev = findPlan(pt, shiftPeriod(pt, key, -1, app.settings.weekStart));
    if (!prev?.targets.length) return toast(t('plan.noPrev'), 'error');
    await savePlan(pt, key, { targets: prev.targets });
    toast(t('plan.copied'), 'success');
  }
  async function saveNote(note: string) {
    if (note !== (plan?.note ?? '')) await savePlan(pt, key, { note });
  }
</script>

<div class="page narrow">
  <header class="page-header">
    <div>
      <h1>{t('nav.plans')}</h1>
      <div class="subtitle">{t('plan.subtitle')}</div>
    </div>
    <button class="btn" onclick={copyPrev}><Copy size={17} />{t('plan.copyPrev')}</button>
  </header>

  <PeriodNav bind:type bind:key types={['week', 'month', 'year']} />

  <section class="card glass">
    <div class="card-title">{t('plan.targets')}<small>{t('plan.totalTarget', { h: fmtHours(totalTarget * MIN) })}</small></div>
    <div class="rows">
      {#each rows as { cat, depth } (cat.id)}
        {@const target = targets.get(cat.id) || 0}
        {@const actual = stats.byCategoryRollup.get(cat.id) || 0}
        {@const ratio = target ? actual / (target * MIN) : 0}
        <div class="prow" style="--c:{cat.color};padding-left:{depth * 20}px">
          <div class="top">
            <span class="dot"></span>
            <span class="grow ellipsis" class:sub={depth > 0}>{cat.name}</span>
            <span class="num small muted">{fmtDur(actual, i18n.lang)}</span>
            <label class="hin">
              <input class="input num" type="number" min="0" step="0.5" inputmode="decimal" value={target ? +(target / 60).toFixed(2) : ''} placeholder="0" onchange={(e) => setTarget(cat.id, (e.target as HTMLInputElement).value)} aria-label="{cat.name} {t('plan.target')}" />
              <span>h</span>
            </label>
          </div>
          {#if target}
            <div class="bar"><i style="width:{Math.min(100, ratio * 100)}%;--c:{ratio >= 1 ? 'var(--green-bright)' : cat.color}"></i></div>
            <div class="small muted pct">{Math.round(ratio * 100)}% · {ratio >= 1 ? t('plan.achieved') : t('plan.remaining', { d: fmtDur(target * MIN - actual, i18n.lang) })}</div>
          {/if}
        </div>
      {/each}
    </div>
  </section>

  <section class="card glass">
    <div class="card-title">{t('plan.note')}</div>
    <textarea class="input" rows="4" value={plan?.note ?? ''} placeholder={t('plan.notePh')} onchange={(e) => saveNote((e.target as HTMLTextAreaElement).value)}></textarea>
  </section>
</div>

<style>
  .narrow {
    max-width: 820px;
  }
  .rows {
    display: flex;
    flex-direction: column;
  }
  .prow {
    padding-top: 10px;
    padding-bottom: 10px;
    border-top: 0.5px solid var(--hairline);
  }
  .prow:first-child {
    border-top: 0;
  }
  .top {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .grow {
    flex: 1;
    min-width: 0;
    font-weight: 600;
  }
  .grow.sub {
    font-weight: 500;
  }
  .hin {
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--text-2);
  }
  .hin input {
    width: 80px;
    min-height: 38px;
    padding: 6px 10px;
    text-align: right;
  }
  .bar {
    margin: 8px 0 4px 20px;
  }
  .pct {
    margin-left: 20px;
  }
  textarea.input {
    min-height: 100px;
    resize: vertical;
  }
</style>
