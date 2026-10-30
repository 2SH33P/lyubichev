<script lang="ts">
  import { Plus, Play, Square, Flag, Clock, ListChecks, Circle, CircleCheck } from '@lucide/svelte';
  import Seg from '../components/Seg.svelte';
  import CatChip from '../components/CatChip.svelte';
  import { app, newTodoDraft, saveTodo, startTimer, stopTimer, toggleTodo } from '../lib/app.svelte';
  import { i18n, t } from '../lib/i18n/index.svelte';
  import { addDays, dayKey, fmtDur, fmtTime, startOfDay } from '../lib/time';
  import type { Todo } from '../lib/types';
  import { editTodo, pickCategory, report, toast } from '../lib/ui.svelte';

  type View = 'today' | 'upcoming' | 'all' | 'done';
  let view = $state<View>('today');
  let quick = $state('');

  const today0 = $derived(startOfDay(app.now));
  const tomorrow0 = $derived(addDays(today0, 1));
  const open = (x: Todo) => x.status === 'todo' || x.status === 'doing';
  const byPrio = (a: Todo, b: Todo) => b.priority - a.priority || (a.due ?? Infinity) - (b.due ?? Infinity) || a.order - b.order;

  const lists = $derived({
    today: app.todos.filter((x) => open(x) && ((x.due !== null && x.due < tomorrow0) || x.status === 'doing')).sort(byPrio),
    upcoming: app.todos.filter((x) => open(x) && x.due !== null && x.due >= tomorrow0).sort((a, b) => a.due! - b.due!),
    all: app.todos.filter(open).sort(byPrio),
    done: app.todos.filter((x) => !open(x)).sort((a, b) => (b.completedAt ?? b.updatedAt) - (a.completedAt ?? a.updatedAt))
  });
  const items = $derived(lists[view]);
  const runningTodo = $derived(new Map(app.running.filter((r) => r.todoId).map((r) => [r.todoId!, r.id])));

  async function add() {
    const title = quick.trim();
    if (!title) return;
    const td = newTodoDraft(title);
    if (view === 'today') td.due = today0;
    try {
      await saveTodo(td);
      quick = '';
    } catch (e) {
      report(e);
    }
  }

  async function play(td: Todo) {
    const rid = runningTodo.get(td.id);
    if (rid) return stopTimer(rid);
    let cat = td.categoryId;
    if (!cat) {
      cat = await pickCategory(t('todo.pickCategory'));
      if (!cat) return;
      await saveTodo({ ...td, categoryId: cat });
    }
    await startTimer(cat, { todoId: td.id, note: td.title });
    toast(t('todo.started'), 'success');
  }

  function dueLabel(td: Todo) {
    if (td.due === null) return '';
    const d = startOfDay(td.due);
    const base = d === today0 ? t('todo.today') : d === tomorrow0 ? t('todo.tomorrow') : dayKey(td.due);
    return td.dueAllDay ? base : `${base} ${fmtTime(td.due)}`;
  }
</script>

<div class="page narrow">
  <header class="page-header">
    <div>
      <h1>{t('nav.todos')}</h1>
      <div class="subtitle">{t('todo.subtitle', { n: lists.all.length })}</div>
    </div>
    <button class="btn primary" onclick={() => editTodo(newTodoDraft(), true)}><Plus size={18} />{t('todo.new')}</button>
  </header>

  <form class="add glass" onsubmit={(e) => (e.preventDefault(), add())}>
    <Plus size={20} class="faint" />
    <input bind:value={quick} placeholder={t('todo.quickAdd')} aria-label={t('todo.quickAdd')} />
    {#if quick}<button class="btn small primary" type="submit">{t('common.add')}</button>{/if}
  </form>

  <div class="segwrap">
    <Seg
      bind:value={view}
      label={t('nav.todos')}
      options={[
        { value: 'today', label: `${t('todo.view.today')} ${lists.today.length || ''}` },
        { value: 'upcoming', label: `${t('todo.view.upcoming')} ${lists.upcoming.length || ''}` },
        { value: 'all', label: t('todo.view.all') },
        { value: 'done', label: t('todo.view.done') }
      ]}
    />
  </div>

  {#if !items.length}
    <div class="card glass empty">{t('todo.empty.' + view)}</div>
  {:else}
    <div class="list glass">
      {#each items as td (td.id)}
        {@const actual = app.todoActual.get(td.id) || 0}
        {@const subDone = td.subtasks.filter((s) => s.done).length}
        {@const overdue = td.due !== null && open(td) && (td.dueAllDay ? td.due < today0 : td.due < app.now)}
        <div class="row item" class:done={!open(td)}>
          <button class="check" class:on={td.status === 'done'} onclick={() => toggleTodo(td)} aria-label={t('todo.toggle')}>
            {#if td.status === 'done'}<CircleCheck size={26} />{:else}<Circle size={26} />{/if}
          </button>
          <button class="grow main" onclick={() => editTodo(td)}>
            <div class="title">
              {#if td.priority}<Flag size={14} class="prio p{td.priority}" fill="currentColor" />{/if}
              <span class="ellipsis">{td.title}</span>
              {#if td.status === 'doing'}<span class="badge primary">{t('todo.status.doing')}</span>{/if}
              {#if td.status === 'cancelled'}<span class="badge">{t('todo.status.cancelled')}</span>{/if}
            </div>
            <div class="meta">
              {#if td.due !== null}<span class:overdue>{dueLabel(td)}</span>{/if}
              {#if td.categoryId}<CatChip id={td.categoryId} />{/if}
              {#if actual || td.estimateMin}<span class="num"><Clock size={12} /> {fmtDur(actual, i18n.lang)}{td.estimateMin ? ' / ' + fmtDur(td.estimateMin * 60000, i18n.lang) : ''}</span>{/if}
              {#if td.subtasks.length}<span><ListChecks size={12} /> {subDone}/{td.subtasks.length}</span>{/if}
              {#each td.tags as tg (tg)}<span class="faint">#{tg}</span>{/each}
            </div>
          </button>
          {#if open(td)}
            <button class="icon-btn small" class:primary={runningTodo.has(td.id)} onclick={() => play(td)} aria-label={runningTodo.has(td.id) ? t('today.stop') : t('todo.start')}>
              {#if runningTodo.has(td.id)}<Square size={14} fill="currentColor" />{:else}<Play size={15} fill="currentColor" />{/if}
            </button>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .narrow {
    max-width: 820px;
  }
  .add {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px 6px 16px;
    border-radius: 999px;
    margin-bottom: 14px;
  }
  .add input {
    flex: 1;
    min-width: 0;
    min-height: 44px;
    border: 0;
    background: transparent;
    outline: none;
    font-size: 16px;
  }
  .segwrap {
    margin-bottom: 14px;
  }
  .item {
    align-items: flex-start;
    padding: 12px 14px;
  }
  .check {
    border: 0;
    background: none;
    padding: 0;
    color: var(--text-3);
    cursor: pointer;
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    flex: none;
    margin-top: -2px;
  }
  .check.on {
    color: var(--accent);
  }
  .main {
    border: 0;
    background: none;
    text-align: left;
    padding: 0;
    cursor: pointer;
    min-width: 0;
    color: inherit;
  }
  .title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 16px;
    font-weight: 560;
  }
  .done .title {
    color: var(--text-3);
    text-decoration: line-through;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 10px;
    margin-top: 4px;
    font-size: 13px;
    color: var(--text-2);
  }
  .meta :global(.chip) {
    min-height: 22px;
    font-size: 12px;
    padding: 1px 8px 1px 6px;
  }
  .meta span {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  .overdue {
    color: var(--red);
    font-weight: 600;
  }
  :global(.prio.p1) { color: var(--accent); }
  :global(.prio.p2) { color: var(--orange-bright); }
  :global(.prio.p3) { color: var(--red-bright); }
</style>
