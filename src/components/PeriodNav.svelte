<script lang="ts">
  import { ChevronLeft, ChevronRight } from '@lucide/svelte';
  import Seg from './Seg.svelte';
  import { app } from '../lib/app.svelte';
  import { t } from '../lib/i18n/index.svelte';
  import { periodKeyOf, shiftPeriod } from '../lib/time';
  import { periodLabel } from '../lib/period';

  type PT = 'day' | 'week' | 'month' | 'year';
  let { type = $bindable(), key = $bindable(), types = ['day', 'week', 'month', 'year'] as PT[] }: { type: PT; key: string; types?: PT[] } = $props();

  const isCurrent = $derived(key === periodKeyOf(type, app.now, app.settings.weekStart));
</script>

<div class="pnav">
  <Seg bind:value={type} options={types.map((x) => ({ value: x, label: t('period.' + x) }))} onchange={(v) => (key = periodKeyOf(v, Date.now(), app.settings.weekStart))} />
  <div class="nav">
    <button class="icon-btn" onclick={() => (key = shiftPeriod(type, key, -1, app.settings.weekStart))} aria-label={t('common.prev')}><ChevronLeft size={20} /></button>
    <div class="label">{periodLabel(type, key)}</div>
    <button class="icon-btn" onclick={() => (key = shiftPeriod(type, key, 1, app.settings.weekStart))} aria-label={t('common.next')}><ChevronRight size={20} /></button>
    {#if !isCurrent}<button class="btn small" onclick={() => (key = periodKeyOf(type, Date.now(), app.settings.weekStart))}>{t('period.current')}</button>{/if}
  </div>
</div>

<style>
  .pnav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px;
    margin-bottom: 16px;
  }
  .nav {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .label {
    min-width: 150px;
    text-align: center;
    font-weight: 650;
    font-size: 16px;
  }
</style>
