<script lang="ts">
  import { History, Plus, Trash2, Play } from '@lucide/svelte';
  import Sheet from './Sheet.svelte';
  import Seg from './Seg.svelte';
  import CategorySelect from './CategorySelect.svelte';
  import HistoryList from './HistoryList.svelte';
  import { app, deleteTodo, saveTodo, startTimer, ActionError } from '../lib/app.svelte';
  import { i18n, t } from '../lib/i18n/index.svelte';
  import { uuid } from '../lib/ids';
  import { dayKey, fmtDur, fmtDateTime, netMs, parseDayKey, fmtTime } from '../lib/time';
  import type { Todo } from '../lib/types';
  import { confirmDialog, editEntry, report, toast, ui } from '../lib/ui.svelte';

  let open = $state(false);
  let draft = $state<Todo | null>(null);
  let isNew = $state(false);
  let dueDate = $state('');
  let dueTime = $state('');
  let tagsStr = $state('');
  let newSub = $state('');
  let showHistory = $state(false);

  $effect(() => {
    const req = ui.todo;
    if (!req) return;
    draft = req.todo;
    isNew = req.isNew;
    dueDate = req.todo.due ? dayKey(req.todo.due) : '';
    dueTime = req.todo.due && !req.todo.dueAllDay ? fmtTime(req.todo.due) : '';
    tagsStr = req.todo.tags.join(', ');
    newSub = '';
    showHistory = false;
    open = true;
    ui.todo = null;
  });

  const linked = $derived(draft ? app.entries.filter((e) => e.todoId === draft!.id).sort((a, b) => b.start - a.start) : []);
  const actual = $derived(linked.reduce((s, e) => s + netMs(e, app.now), 0));

  function build(): Todo | null {
    if (!draft) return null;
    let due: number | null = null;
    if (dueDate) {
      due = parseDayKey(dueDate);
      if (dueTime) {
        const [h, m] = dueTime.split(':').map(Number);
        due += (h * 60 + m) * 60_000;
      }
    }
    return {
      ...draft,
      due,
      dueAllDay: !dueTime,
      tags: tagsStr.split(/[,，;；]/).map((x) => x.trim().replace(/^#/, '')).filter(Boolean),
      estimateMin: draft.estimateMin ? Number(draft.estimateMin) : null,
      priority: Number(draft.priority) as Todo['priority']
    };
  }

  async function save() {
    const td = build();
    if (!td) return;
    try {
      await saveTodo(td);
      open = false;
    } catch (e) {
      if (e instanceof ActionError) toast(e.message, 'error');
      else report(e);
    }
  }

  async function remove() {
    if (!draft || !(await confirmDialog({ title: t('todo.deleteConfirm'), okText: t('common.delete'), danger: true }))) return;
    await deleteTodo(draft.id);
    open = false;
  }

  async function start() {
    const td = build();
    if (!td) return;
    if (!td.categoryId) return toast(t('todo.needCategory'), 'error');
    try {
      await saveTodo(td);
      await startTimer(td.categoryId, { todoId: td.id, note: td.title });
      open = false;
    } catch (e) {
      report(e);
    }
  }

  function addSub() {
    if (!draft || !newSub.trim()) return;
    draft.subtasks = [...draft.subtasks, { id: uuid(), title: newSub.trim(), done: false }];
    newSub = '';
  }

  const describe = (d: Todo) => `${d.title} · ${t('todo.status.' + d.status)}${d.due ? ' · ' + dayKey(d.due) : ''}`;
</script>

<Sheet bind:open title={isNew ? t('todo.new') : t('todo.edit')}>
  {#snippet actions()}
    {#if !isNew}
      <button class="icon-btn small" class:primary={showHistory} onclick={() => (showHistory = !showHistory)} aria-label={t('history.title')}><History size={17} /></button>
    {/if}
  {/snippet}
  {#if draft}
    {#if showHistory}
      <HistoryList table="todos" recordId={draft.id} {describe} onrestored={() => (open = false)} />
      <div class="hr"></div>
    {/if}
    <label class="field"><span>{t('todo.title')}</span><input bind:value={draft.title} placeholder={t('todo.titlePh')} /></label>
    <label class="field"><span>{t('todo.notes')}</span><textarea bind:value={draft.notes}></textarea></label>
    <div class="field">
      <span>{t('todo.priority')}</span>
      <Seg
        block
        bind:value={draft.priority}
        options={[
          { value: 0, label: t('todo.prio.0') },
          { value: 1, label: t('todo.prio.1') },
          { value: 2, label: t('todo.prio.2') },
          { value: 3, label: t('todo.prio.3') }
        ]}
      />
    </div>
    <div class="grid-2" style="margin-bottom:14px">
      <label class="field"><span>{t('todo.dueDate')}</span><input type="date" bind:value={dueDate} /></label>
      <label class="field"><span>{t('todo.dueTime')}</span><input type="time" bind:value={dueTime} disabled={!dueDate} /></label>
    </div>
    <div class="grid-2" style="margin-bottom:14px">
      <label class="field"><span>{t('common.category')}</span><CategorySelect bind:value={draft.categoryId} allowEmpty /></label>
      <label class="field"><span>{t('todo.estimate')}</span><input type="number" min="0" step="5" inputmode="numeric" bind:value={draft.estimateMin} placeholder={t('todo.minutes')} /></label>
    </div>
    <label class="field">
      <span>{t('todo.statusLabel')}</span>
      <select class="input" bind:value={draft.status}>
        {#each ['todo', 'doing', 'done', 'cancelled'] as s (s)}<option value={s}>{t('todo.status.' + s)}</option>{/each}
      </select>
    </label>
    <label class="field"><span>{t('entry.tags')}</span><input bind:value={tagsStr} placeholder={t('entry.tagsPh')} /></label>

    <div class="field">
      <span>{t('todo.subtasks')}</span>
      <div class="glass-thin list">
        {#each draft.subtasks as s, i (s.id)}
          <div class="row">
            <input type="checkbox" class="check" bind:checked={s.done} aria-label={s.title} />
            <input class="grow plain-input" bind:value={s.title} class:done={s.done} />
            <button class="icon-btn small plain" onclick={() => (draft!.subtasks = draft!.subtasks.filter((_, j) => j !== i))} aria-label={t('common.delete')}><Trash2 size={16} /></button>
          </div>
        {/each}
        <div class="row">
          <Plus size={18} class="faint" />
          <input class="grow plain-input" bind:value={newSub} placeholder={t('todo.addSubtask')} onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), addSub())} onblur={addSub} />
        </div>
      </div>
    </div>

    {#if !isNew}
      <div class="field">
        <span>{t('todo.timeSpent')} · {fmtDur(actual, i18n.lang)}{draft.estimateMin ? ' / ' + fmtDur(draft.estimateMin * 60000, i18n.lang) : ''}</span>
        {#if linked.length}
          <div class="glass-thin list">
            {#each linked.slice(0, 8) as e (e.id)}
              <button class="row row-btn" onclick={() => { open = false; editEntry(e); }}>
                <span class="grow small">{fmtDateTime(e.start)}</span>
                <span class="num small">{fmtDur(netMs(e, app.now), i18n.lang)}</span>
              </button>
            {/each}
          </div>
        {:else}
          <div class="small muted" style="padding-left:4px">{t('todo.noTime')}</div>
        {/if}
      </div>
    {/if}
  {/if}
  {#snippet footer()}
    {#if !isNew}<button class="btn danger" onclick={remove} aria-label={t('common.delete')}><Trash2 size={17} /></button>{/if}
    {#if draft?.status !== 'done'}<button class="btn" onclick={start}><Play size={17} />{t('todo.start')}</button>{/if}
    <button class="btn primary" onclick={save}>{t('common.save')}</button>
  {/snippet}
</Sheet>

<style>
  .plain-input {
    border: 0;
    background: transparent;
    outline: none;
    min-height: 32px;
    font-size: 16px;
    min-width: 0;
  }
  .plain-input.done {
    text-decoration: line-through;
    color: var(--text-3);
  }
  .check {
    width: 22px;
    height: 22px;
    accent-color: var(--accent);
    flex: none;
  }
</style>
