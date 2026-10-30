<script lang="ts">
  import { Lock, Plus, Trash2, History, TriangleAlert } from '@lucide/svelte';
  import Sheet from './Sheet.svelte';
  import CategorySelect from './CategorySelect.svelte';
  import HistoryList from './HistoryList.svelte';
  import { app, deleteEntries, isLocked, saveEntry, ActionError } from '../lib/app.svelte';
  import { i18n, t } from '../lib/i18n/index.svelte';
  import { fmtDur, fmtDateTime, fromLocalInput, netMs, toLocalInput, MIN, HOUR } from '../lib/time';
  import type { Entry } from '../lib/types';
  import { confirmDialog, report, toast, ui } from '../lib/ui.svelte';

  let open = $state(false);
  let draft = $state<Entry | null>(null);
  let isNew = $state(false);
  let startStr = $state('');
  let endStr = $state('');
  let tagsStr = $state('');
  let amount = $state<number | null>(null);
  let unit = $state('');
  let pauses = $state<{ s: string; e: string }[]>([]);
  let conflicts = $state<Entry[]>([]);
  let showHistory = $state(false);
  let busy = $state(false);

  $effect(() => {
    const req = ui.entry;
    if (!req) return;
    const e = req.entry;
    draft = e;
    isNew = req.isNew;
    startStr = toLocalInput(e.start);
    endStr = e.end !== null ? toLocalInput(e.end) : '';
    tagsStr = e.tags.join(', ');
    amount = e.output?.amount ?? null;
    unit = e.output?.unit ?? app.idx.get(e.categoryId)?.unit ?? '';
    pauses = e.pauses.map((p) => ({ s: toLocalInput(p.start), e: p.end !== null ? toLocalInput(p.end) : '' }));
    conflicts = [];
    showHistory = false;
    open = true;
    ui.entry = null;
  });

  const running = $derived(draft?.end === null);
  const locked = $derived(!!draft && !isNew && isLocked(draft.start));
  const built = $derived.by((): Entry | null => {
    if (!draft) return null;
    const start = fromLocalInput(startStr);
    const end = running ? null : fromLocalInput(endStr);
    return {
      ...draft,
      start,
      end,
      pauses: pauses
        .map((p) => ({ start: fromLocalInput(p.s), end: p.e ? fromLocalInput(p.e) : null }))
        .filter((p) => Number.isFinite(p.start) && (p.end === null || p.end > p.start)),
      tags: tagsStr.split(/[,，;；]/).map((x) => x.trim().replace(/^#/, '')).filter(Boolean),
      output: amount ? { amount: Number(amount), unit: unit.trim() } : null
    };
  });
  const net = $derived(built && Number.isFinite(built.start) ? netMs(built, app.now) : 0);
  const openTodos = $derived(app.todos.filter((x) => x.status !== 'done' && x.status !== 'cancelled' || x.id === draft?.todoId));

  function bump(min: number) {
    const s = fromLocalInput(startStr);
    const base = endStr ? fromLocalInput(endStr) : s;
    endStr = toLocalInput(base + min * MIN);
  }

  function addPause() {
    const s = fromLocalInput(startStr);
    const e = endStr ? fromLocalInput(endStr) : Date.now();
    const mid = s + (e - s) / 2;
    pauses = [...pauses, { s: toLocalInput(mid), e: toLocalInput(Math.min(e, mid + 10 * MIN)) }];
  }

  $effect(() => {
    // 切换类别时带出默认产出单位
    const c = draft ? app.idx.get(draft.categoryId) : undefined;
    if (c?.unit && !unit) unit = c.unit;
  });

  async function save(trim = false) {
    if (!built) return;
    if (!Number.isFinite(built.start) || (!running && !Number.isFinite(built.end!))) return toast(t('err.invalidTime'), 'error');
    busy = true;
    try {
      const r = await saveEntry(built, { trim });
      if (!r.ok && r.conflicts) {
        conflicts = r.conflicts;
        return;
      }
      toast(isNew ? t('entry.added') : t('entry.saved'), 'success');
      open = false;
    } catch (e) {
      if (e instanceof ActionError) toast(e.message, 'error');
      else report(e);
    } finally {
      busy = false;
    }
  }

  async function remove() {
    if (!draft) return;
    if (!(await confirmDialog({ title: t('entry.deleteConfirm'), okText: t('common.delete'), danger: true }))) return;
    try {
      await deleteEntries([draft.id]);
      open = false;
      toast(t('entry.deleted'));
    } catch (e) {
      report(e);
    }
  }

  const describe = (d: Entry) => `${fmtDateTime(d.start)} · ${fmtDur(netMs(d, d.end ?? d.start), i18n.lang)} · ${app.idx.pathName(d.categoryId)}${d.note ? ' · ' + d.note : ''}`;
</script>

<Sheet bind:open title={isNew ? t('entry.new') : t('entry.edit')}>
  {#snippet actions()}
    {#if !isNew}
      <button class="icon-btn small" class:primary={showHistory} onclick={() => (showHistory = !showHistory)} aria-label={t('history.title')}><History size={17} /></button>
    {/if}
  {/snippet}
  {#if draft}
    {#if locked}
      <div class="notice"><Lock size={16} /> {t('entry.lockedHint')}</div>
    {/if}
    {#if showHistory}
      <div class="label" style="margin-bottom:8px">{t('history.title')}</div>
      <HistoryList table="entries" recordId={draft.id} {describe} onrestored={() => (open = false)} />
      <div class="hr"></div>
    {/if}

    <label class="field"><span>{t('common.category')}</span><CategorySelect bind:value={draft.categoryId} /></label>
    <div class="grid-2 stack-sm" style="margin-bottom:14px">
      <label class="field"><span>{t('entry.start')}</span><input type="datetime-local" bind:value={startStr} /></label>
      {#if running}
        <div class="field"><span>{t('entry.end')}</span><div class="input running">{t('entry.running')}</div></div>
      {:else}
        <label class="field"><span>{t('entry.end')}</span><input type="datetime-local" bind:value={endStr} /></label>
      {/if}
    </div>
    {#if !running}
      <div class="quick">
        {#each [15, 30, 60] as m (m)}<button class="btn small" onclick={() => bump(m)}>+{m >= 60 ? m / 60 + 'h' : m + 'm'}</button>{/each}
        <span class="spacer"></span>
        <div class="net">{t('entry.net')} <b class="num">{fmtDur(net, i18n.lang)}</b></div>
      </div>
    {/if}

    <div class="field">
      <span>{t('entry.pauses')}</span>
      {#each pauses as p, i (i)}
        <div class="pause">
          <input class="input" type="datetime-local" bind:value={p.s} aria-label={t('entry.pauseStart')} />
          <span class="faint">→</span>
          <input class="input" type="datetime-local" bind:value={p.e} aria-label={t('entry.pauseEnd')} />
          <button class="icon-btn small plain" onclick={() => (pauses = pauses.filter((_, j) => j !== i))} aria-label={t('common.delete')}><Trash2 size={16} /></button>
        </div>
      {/each}
      <button class="btn small plain addp" onclick={addPause}><Plus size={16} />{t('entry.addPause')}</button>
    </div>

    <label class="field"><span>{t('entry.note')}</span><textarea bind:value={draft.note} placeholder={t('entry.notePh')}></textarea></label>
    <label class="field"><span>{t('entry.tags')}</span><input bind:value={tagsStr} placeholder={t('entry.tagsPh')} /></label>
    <div class="grid-2" style="margin-bottom:14px">
      <label class="field"><span>{t('entry.output')}</span><input type="number" inputmode="decimal" min="0" step="any" bind:value={amount} placeholder="0" /></label>
      <label class="field"><span>{t('entry.unit')}</span><input bind:value={unit} placeholder={t('entry.unitPh')} /></label>
    </div>
    {#if openTodos.length}
      <label class="field"
        ><span>{t('entry.todo')}</span>
        <select class="input" bind:value={draft.todoId}>
          <option value={null}>{t('common.none')}</option>
          {#each openTodos as td (td.id)}<option value={td.id}>{td.title}</option>{/each}
        </select>
      </label>
    {/if}

    {#if conflicts.length}
      <div class="conflict">
        <div class="ct"><TriangleAlert size={18} /> {t('entry.overlap', { n: conflicts.length })}</div>
        <ul>
          {#each conflicts as c (c.id)}<li>{app.idx.pathName(c.categoryId)} · {fmtDateTime(c.start)} – {c.end ? fmtDateTime(c.end) : t('entry.running')}</li>{/each}
        </ul>
        <div class="toolbar">
          <button class="btn small primary" onclick={() => save(true)} disabled={busy}>{t('entry.trimAndSave')}</button>
          <button class="btn small" onclick={() => (conflicts = [])}>{t('common.cancel')}</button>
        </div>
        <div class="small muted" style="margin-top:8px">{t('entry.overlapHint')}</div>
      </div>
    {/if}
  {/if}
  {#snippet footer()}
    {#if !isNew}<button class="btn danger" onclick={remove} disabled={locked}><Trash2 size={17} />{t('common.delete')}</button>{/if}
    <button class="btn primary" onclick={() => save(false)} disabled={busy || locked}>{t('common.save')}</button>
  {/snippet}
</Sheet>

<style>
  .quick {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: -2px 0 16px;
    flex-wrap: wrap;
  }
  .net {
    font-size: 14px;
    color: var(--text-2);
  }
  .net b {
    color: var(--text);
    font-size: 17px;
    margin-left: 4px;
  }
  .running {
    display: flex;
    align-items: center;
    color: var(--green);
    font-weight: 600;
  }
  .pause {
    display: grid;
    grid-template-columns: 1fr auto 1fr auto;
    gap: 6px;
    align-items: center;
  }
  .pause .input {
    min-width: 0;
    font-size: 14px;
    padding: 8px 10px;
  }
  .addp {
    align-self: flex-start;
    padding-left: 4px;
  }
  .notice,
  .conflict {
    border-radius: var(--r-md);
    padding: 12px 14px;
    margin-bottom: 14px;
    font-size: 14px;
  }
  .notice {
    display: flex;
    gap: 8px;
    align-items: center;
    background: color-mix(in srgb, var(--orange-bright) 16%, transparent);
    color: var(--orange);
  }
  .conflict {
    background: color-mix(in srgb, var(--red-bright) 12%, transparent);
  }
  .ct {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 650;
    color: var(--red);
  }
  .conflict ul {
    margin: 8px 0 10px;
    padding-left: 20px;
  }
  @media (max-width: 480px) {
    .pause {
      grid-template-columns: 1fr 1fr auto;
      gap: 4px;
    }
    .pause span {
      display: none;
    }
    .pause .input {
      font-size: 13px;
      padding: 8px 6px;
    }
  }
</style>
