<script lang="ts">
  import { Plus, Download, Trash2, CheckSquare, X, Lock } from '@lucide/svelte';
  import Seg from '../components/Seg.svelte';
  import CategorySelect from '../components/CategorySelect.svelte';
  import { app, deleteEntries, isLocked, newEntryDraft } from '../lib/app.svelte';
  import { entriesToCsv } from '../lib/csv';
  import { i18n, t } from '../lib/i18n/index.svelte';
  import { download } from '../lib/importExport';
  import { addDays, dayKey, fmtDur, fmtTime, netMs, parseDayKey, startOfDay, DAY } from '../lib/time';
  import { confirmDialog, editEntry, report, toast } from '../lib/ui.svelte';

  type Preset = '7' | '30' | 'month' | 'all' | 'custom';
  let preset = $state<Preset>('30');
  let fromStr = $state(dayKey(addDays(Date.now(), -30)));
  let toStr = $state(dayKey(Date.now()));
  let cat = $state<string | null>(null);
  let q = $state('');
  let selecting = $state(false);
  let selected = $state(new Set<string>());
  let limit = $state(30);

  const range = $derived.by((): [number, number] => {
    const today = startOfDay(app.now);
    if (preset === '7') return [addDays(today, -6), today + DAY];
    if (preset === '30') return [addDays(today, -29), today + DAY];
    if (preset === 'month') {
      const d = new Date(today);
      return [new Date(d.getFullYear(), d.getMonth(), 1).getTime(), today + DAY];
    }
    if (preset === 'all') return [0, Infinity];
    return [parseDayKey(fromStr), parseDayKey(toStr) + DAY];
  });

  const catSet = $derived(cat ? new Set(app.idx.descendants(cat)) : null);
  const filtered = $derived.by(() => {
    const needle = q.trim().toLowerCase();
    return app.entries
      .filter((e) => e.start >= range[0] && e.start < range[1])
      .filter((e) => !catSet || catSet.has(e.categoryId))
      .filter((e) => !needle || e.note.toLowerCase().includes(needle) || e.tags.some((x) => x.toLowerCase().includes(needle)) || app.idx.pathName(e.categoryId).toLowerCase().includes(needle))
      .sort((a, b) => b.start - a.start);
  });
  const groups = $derived.by(() => {
    const m = new Map<string, typeof filtered>();
    for (const e of filtered) {
      const k = dayKey(e.start);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(e);
    }
    return [...m.entries()];
  });
  const total = $derived(filtered.reduce((s, e) => s + netMs(e, app.now), 0));

  function toggle(id: string) {
    const s = new Set(selected);
    s.has(id) ? s.delete(id) : s.add(id);
    selected = s;
  }
  async function bulkDelete() {
    if (!selected.size) return;
    if (!(await confirmDialog({ title: t('entries.bulkDeleteConfirm', { n: selected.size }), message: t('entries.bulkDeleteHint'), okText: t('common.delete'), danger: true }))) return;
    try {
      await deleteEntries([...selected]);
      toast(t('entries.deleted', { n: selected.size }), 'success');
      selected = new Set();
      selecting = false;
    } catch (e) {
      report(e);
    }
  }
  function exportCsv() {
    download(`entries-${dayKey(Date.now())}.csv`, entriesToCsv(filtered, app.idx, app.todoById), 'text/csv;charset=utf-8');
  }
  function weekdayOf(k: string) {
    return new Date(parseDayKey(k)).toLocaleDateString(i18n.lang === 'zh' ? 'zh-CN' : 'en-US', { weekday: 'short' });
  }
</script>

<div class="page narrow">
  <header class="page-header">
    <div>
      <h1>{t('nav.entries')}</h1>
      <div class="subtitle">{t('entries.summary', { n: filtered.length, d: fmtDur(total, i18n.lang) })}</div>
    </div>
    <div class="toolbar">
      {#if selecting}
        <button class="btn danger" onclick={bulkDelete} disabled={!selected.size}><Trash2 size={17} />{t('common.delete')} {selected.size || ''}</button>
        <button class="icon-btn" onclick={() => ((selecting = false), (selected = new Set()))} aria-label={t('common.cancel')}><X size={18} /></button>
      {:else}
        <button class="icon-btn" onclick={() => (selecting = true)} aria-label={t('entries.select')} title={t('entries.select')}><CheckSquare size={18} /></button>
        <button class="icon-btn" onclick={exportCsv} aria-label={t('entries.exportCsv')} title={t('entries.exportCsv')}><Download size={18} /></button>
        <button class="btn primary" onclick={() => editEntry(newEntryDraft(Date.now() - 30 * 60000, Date.now()), true)}><Plus size={18} />{t('common.add')}</button>
      {/if}
    </div>
  </header>

  <section class="card glass filters">
    <Seg
      bind:value={preset}
      options={[
        { value: '7', label: t('entries.p7') },
        { value: '30', label: t('entries.p30') },
        { value: 'month', label: t('entries.pMonth') },
        { value: 'all', label: t('entries.pAll') },
        { value: 'custom', label: t('entries.pCustom') }
      ]}
    />
    {#if preset === 'custom'}
      <div class="grid-2">
        <label class="field"><span>{t('entries.from')}</span><input type="date" bind:value={fromStr} /></label>
        <label class="field"><span>{t('entries.to')}</span><input type="date" bind:value={toStr} /></label>
      </div>
    {/if}
    <div class="grid-2 stack-sm">
      <CategorySelect bind:value={cat} allowEmpty emptyLabel={t('entries.allCategories')} includeArchived />
      <input class="input" type="search" bind:value={q} placeholder={t('entries.searchPh')} />
    </div>
  </section>

  {#if !groups.length}
    <div class="card glass empty">{t('entries.empty')}</div>
  {/if}
  {#each groups.slice(0, limit) as [k, list] (k)}
    <div class="list-header day">
      <span>{k} · {weekdayOf(k)}</span>
      <span class="num">{fmtDur(list.reduce((s, e) => s + netMs(e, app.now), 0), i18n.lang)}</span>
    </div>
    <div class="list glass">
      {#each list as e (e.id)}
        <button class="row row-btn" onclick={() => (selecting ? toggle(e.id) : editEntry(e))} style="--c:{app.idx.get(e.categoryId)?.color}">
          {#if selecting}<input type="checkbox" class="cb" checked={selected.has(e.id)} tabindex="-1" aria-hidden="true" />{/if}
          <span class="cbar"></span>
          <span class="grow">
            <span class="line1"><b>{app.idx.pathName(e.categoryId)}</b>{#if isLocked(e.start)}<Lock size={12} />{/if}</span>
            <span class="sub ellipsis">
              {fmtTime(e.start)}–{e.end ? fmtTime(e.end) : '…'}{e.note ? ' · ' + e.note : ''}{e.output ? ` · ${e.output.amount} ${e.output.unit}` : ''}{e.tags.length ? ' · #' + e.tags.join(' #') : ''}
            </span>
          </span>
          <span class="num dur">{fmtDur(netMs(e, app.now), i18n.lang)}</span>
        </button>
      {/each}
    </div>
  {/each}
  {#if groups.length > limit}
    <div style="text-align:center;margin-top:16px"><button class="btn" onclick={() => (limit += 30)}>{t('common.loadMore')}</button></div>
  {/if}
</div>

<style>
  .narrow {
    max-width: 860px;
  }
  .filters {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-bottom: 8px;
  }
  .filters .field {
    margin: 0;
  }
  .day {
    display: flex;
    justify-content: space-between;
    text-transform: none;
    letter-spacing: 0;
    font-size: 14px;
  }
  .cbar {
    width: 5px;
    align-self: stretch;
    border-radius: 4px;
    background: var(--c);
    flex: none;
  }
  .line1 {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 15px;
  }
  .line1 b {
    font-weight: 600;
  }
  .grow {
    display: flex;
    flex-direction: column;
  }
  .dur {
    font-weight: 600;
  }
  .cb {
    width: 20px;
    height: 20px;
    accent-color: var(--accent);
    pointer-events: none;
  }
</style>
