<script lang="ts">
  import { ChevronLeft, ChevronRight, Pause, Play, Square, Plus, Pencil, Trash2, Search, Lock, CircleCheck } from '@lucide/svelte';
  import { app, isLocked, newEntryDraft, pauseTimer, resumeTimer, startTimer, stopTimer, discardTimer, setEntryNote } from '../lib/app.svelte';
  import { i18n, t } from '../lib/i18n/index.svelte';
  import { computeStats, gapsForDay } from '../lib/stats';
  import { addDays, dayKey, fmtClock, fmtDur, fmtTime, isPaused, netMs, startOfDay, DAY } from '../lib/time';
  import type { Entry } from '../lib/types';
  import { confirmDialog, editEntry, editTodo, pickCategory, report, toast } from '../lib/ui.svelte';
  import { go } from '../lib/router.svelte';
  import Donut from '../components/Donut.svelte';
  import DayBar from '../components/DayBar.svelte';
  import CatChip from '../components/CatChip.svelte';

  let day = $state(startOfDay(Date.now()));
  const isToday = $derived(day === startOfDay(app.now));
  const dayEntries = $derived(app.entries.filter((e) => e.start < day + DAY && (e.end ?? app.now) > day).sort((a, b) => a.start - b.start));
  const stats = $derived(computeStats(app.entries, app.idx, [day, day + DAY], app.now));
  const gaps = $derived(gapsForDay(app.entries, day, app.settings, app.now));
  const gapTotal = $derived(gaps.reduce((s, [a, b]) => s + b - a, 0));
  const quick = $derived(app.recentCategories.length ? app.recentCategories.slice(0, 8) : app.idx.flatten().filter((x) => x.depth > 0).slice(0, 8).map((x) => x.cat));
  const dueTodos = $derived(
    app.todos
      .filter((x) => (x.status === 'todo' || x.status === 'doing') && x.due !== null && x.due < day + DAY)
      .sort((a, b) => (a.due ?? 0) - (b.due ?? 0) || b.priority - a.priority)
      .slice(0, 6)
  );

  type Row = { type: 'entry'; e: Entry } | { type: 'gap'; a: number; b: number };
  const rows = $derived.by((): Row[] => {
    const r: Row[] = [...dayEntries.map((e) => ({ type: 'entry' as const, e })), ...gaps.map(([a, b]) => ({ type: 'gap' as const, a, b }))];
    return r.sort((x, y) => (x.type === 'entry' ? x.e.start : x.a) - (y.type === 'entry' ? y.e.start : y.a));
  });

  const weekday = $derived(new Date(day).toLocaleDateString(i18n.lang === 'zh' ? 'zh-CN' : 'en-US', { weekday: 'long', month: 'long', day: 'numeric' }));

  async function start(catId: string) {
    try {
      await startTimer(catId);
    } catch (e) {
      report(e);
    }
  }
  async function startOther() {
    const id = await pickCategory(t('today.pickCategory'));
    if (id) start(id);
  }
  async function stop(id: string) {
    const r = await stopTimer(id);
    if (r === 'discarded') toast(t('today.tooShort', { n: app.settings.minEntryMin }));
    else if (r === 'saved') toast(t('today.stopped'), 'success');
  }
  async function discard(id: string) {
    if (!(await confirmDialog({ title: t('today.discardConfirm'), okText: t('today.discard'), danger: true }))) return;
    await discardTimer(id);
  }
  async function saveNote(e: Entry, note: string) {
    await setEntryNote(e.id, note);
  }
  function addManual(a?: number, b?: number) {
    const now = Date.now();
    const end = b ?? (isToday ? now : day + 12 * 3_600_000);
    const lastEnd = dayEntries.filter((e) => e.end !== null && e.end <= end).at(-1)?.end;
    const start = a ?? lastEnd ?? end - 30 * 60_000;
    editEntry(newEntryDraft(start, end), true);
  }
</script>

<div class="page">
  <header class="page-header">
    <div>
      <h1>{isToday ? t('today.title') : dayKey(day)}</h1>
      <div class="subtitle">{weekday}</div>
    </div>
    <div class="toolbar">
      <button class="icon-btn" onclick={() => (day = addDays(day, -1))} aria-label={t('common.prev')}><ChevronLeft size={20} /></button>
      {#if !isToday}<button class="btn" onclick={() => (day = startOfDay(Date.now()))}>{t('today.today')}</button>{/if}
      <button class="icon-btn" onclick={() => (day = addDays(day, 1))} aria-label={t('common.next')}><ChevronRight size={20} /></button>
    </div>
  </header>

  <div class="cols side">
    <div class="stack">
      {#if app.running.length}
        {#each app.running as r (r.id)}
          {@const paused = isPaused(r)}
          {@const todo = r.todoId ? app.todoById.get(r.todoId) : undefined}
          <section class="card glass timer" style="--c:{app.idx.get(r.categoryId)?.color}">
            <div class="timer-top">
              <CatChip id={r.categoryId} full />
              <span class="badge" class:paused>{paused ? t('today.paused') : t('today.recording')}</span>
            </div>
            <div class="clock num" class:paused aria-live="off">{fmtClock(netMs(r, app.now))}</div>
            <div class="since small muted">{t('today.since', { time: fmtTime(r.start) })}{r.pauses.length ? ' · ' + t('today.pausedCount', { n: r.pauses.length }) : ''}</div>
            {#if todo}<button class="todo-link small" onclick={() => editTodo(todo)}><CircleCheck size={14} /> {todo.title}</button>{/if}
            <input class="input note" value={r.note} placeholder={t('today.notePh')} onchange={(ev) => saveNote(r, (ev.target as HTMLInputElement).value)} />
            <div class="controls">
              <button class="icon-btn" onclick={() => discard(r.id)} aria-label={t('today.discard')}><Trash2 size={18} /></button>
              {#if paused}
                <button class="ctl glass-thin" onclick={() => resumeTimer(r.id)}><Play size={22} fill="currentColor" /><span>{t('today.resume')}</span></button>
              {:else}
                <button class="ctl glass-thin" onclick={() => pauseTimer(r.id)}><Pause size={22} fill="currentColor" /><span>{t('today.pause')}</span></button>
              {/if}
              <button class="ctl stop" onclick={() => stop(r.id)}><Square size={20} fill="currentColor" /><span>{t('today.stop')}</span></button>
              <button class="icon-btn" onclick={() => editEntry(r)} aria-label={t('common.edit')}><Pencil size={18} /></button>
            </div>
          </section>
        {/each}
      {/if}

      <section class="card glass">
        <div class="card-title">{app.running.length ? t('today.switchTo') : t('today.startTitle')}<small>{t('today.startHint')}</small></div>
        <div class="quick">
          {#each quick as c (c.id)}
            <button class="qbtn" style="--c:{c.color}" onclick={() => start(c.id)}>
              <span class="qicon"><Play size={14} fill="currentColor" /></span>
              <span class="ellipsis">{c.name}</span>
            </button>
          {/each}
          <button class="qbtn other" onclick={startOther}><span class="qicon"><Search size={14} /></span><span>{t('today.other')}</span></button>
        </div>
        <div class="hr"></div>
        <button class="btn block" onclick={() => addManual()}><Plus size={18} />{t('today.addManual')}</button>
      </section>

      <section class="card glass">
        <div class="card-title">{t('today.timeline')}<small>{t('today.entriesCount', { n: dayEntries.length })}</small></div>
        <DayBar {day} entries={dayEntries} {gaps} />
        {#if !rows.length}
          <div class="empty">{t('today.empty')}</div>
        {/if}
        <div class="tl">
          {#each rows as row (row.type === 'entry' ? row.e.id : 'g' + row.a)}
            {#if row.type === 'entry'}
              {@const e = row.e}
              <button class="tl-row" onclick={() => editEntry(e)} style="--c:{app.idx.get(e.categoryId)?.color}">
                <span class="tl-time num">{fmtTime(e.start)}<br /><span class="faint">{e.end ? fmtTime(e.end) : '…'}</span></span>
                <span class="tl-line"></span>
                <span class="tl-body">
                  <span class="tl-cat">{app.idx.pathName(e.categoryId)}{#if isLocked(e.start)}<Lock size={12} />{/if}</span>
                  {#if e.note}<span class="tl-note">{e.note}</span>{/if}
                  {#if e.output}<span class="tl-note">{e.output.amount} {e.output.unit}</span>{/if}
                </span>
                <span class="tl-dur num" class:live={e.end === null}>{fmtDur(netMs(e, app.now), i18n.lang)}</span>
              </button>
            {:else}
              <button class="tl-row gap" onclick={() => addManual(row.a, row.b)}>
                <span class="tl-time num faint">{fmtTime(row.a)}<br />{fmtTime(row.b)}</span>
                <span class="tl-line"></span>
                <span class="tl-body"><span class="tl-cat">{t('today.gap')}</span><span class="tl-note">{t('today.gapHint')}</span></span>
                <span class="tl-dur num">{fmtDur(row.b - row.a, i18n.lang)}</span>
              </button>
            {/if}
          {/each}
        </div>
      </section>
    </div>

    <div class="stack">
      <section class="card glass">
        <div class="card-title">{t('today.summary')}</div>
        <div class="summary">
          <Donut
            size={150}
            thickness={16}
            segments={[
              { value: stats.byKind.primary, color: 'var(--purple)', label: t('kind.primary') },
              { value: stats.byKind.secondary, color: 'var(--orange-bright)', label: t('kind.secondary') },
              { value: stats.byKind.life, color: 'var(--green-bright)', label: t('kind.life') }
            ]}
          >
            {#snippet center()}
              <div>
                <div class="big num">{fmtDur(stats.totalMs, i18n.lang)}</div>
                <div class="small muted">{t('stats.total')}</div>
              </div>
            {/snippet}
          </Donut>
          <div class="kinds">
            <div><i style="background:var(--purple)"></i><span>{t('kind.primary')}</span><b class="num">{fmtDur(stats.byKind.primary, i18n.lang)}</b></div>
            <div><i style="background:var(--orange-bright)"></i><span>{t('kind.secondary')}</span><b class="num">{fmtDur(stats.byKind.secondary, i18n.lang)}</b></div>
            <div><i style="background:var(--green-bright)"></i><span>{t('kind.life')}</span><b class="num">{fmtDur(stats.byKind.life, i18n.lang)}</b></div>
            {#if app.settings.gapMin}<div><i class="hatch"></i><span>{t('today.untracked')}</span><b class="num">{fmtDur(gapTotal, i18n.lang)}</b></div>{/if}
          </div>
        </div>
        <div class="hr"></div>
        <div class="kpis">
          <div><span class="small muted">{t('stats.work')}</span><b class="num">{fmtDur(stats.workMs, i18n.lang)}</b></div>
          <div><span class="small muted">{t('stats.primaryShare')}</span><b class="num">{stats.workMs ? Math.round((stats.primaryMs / stats.workMs) * 100) : 0}%</b></div>
        </div>
      </section>

      <section class="card glass">
        <div class="card-title">{t('today.dueTodos')}<button class="btn small plain" onclick={() => go('todos')}>{t('common.all')}</button></div>
        {#if !dueTodos.length}
          <div class="empty small">{t('today.noDue')}</div>
        {:else}
          <div class="list glass-thin">
            {#each dueTodos as td (td.id)}
              <div class="row">
                <button class="grow row-btn plain-row" onclick={() => editTodo(td)}>
                  <div class="ellipsis">{td.title}</div>
                  <div class="sub" class:overdue={td.due! < startOfDay(app.now)}>{dayKey(td.due!)}{td.dueAllDay ? '' : ' ' + fmtTime(td.due!)}</div>
                </button>
                {#if td.categoryId}
                  <button class="icon-btn small" onclick={() => startTimer(td.categoryId!, { todoId: td.id, note: td.title })} aria-label={t('todo.start')}><Play size={15} fill="currentColor" /></button>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </section>
    </div>
  </div>
</div>

<style>
  .timer {
    text-align: center;
    background: linear-gradient(160deg, color-mix(in srgb, var(--c) 22%, var(--glass)), var(--glass) 60%);
  }
  .timer-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }
  .badge.paused {
    background: color-mix(in srgb, var(--orange-bright) 20%, transparent);
    color: var(--orange);
  }
  .clock {
    font-size: clamp(52px, 13vw, 76px);
    font-weight: 300;
    letter-spacing: -0.02em;
    line-height: 1.1;
    margin: 18px 0 4px;
  }
  .clock.paused {
    opacity: 0.5;
  }
  .todo-link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 8px;
    border: 0;
    background: var(--fill);
    border-radius: 99px;
    padding: 4px 12px;
    cursor: pointer;
  }
  .note {
    margin: 14px 0 16px;
    text-align: center;
  }
  .controls {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 12px;
  }
  .ctl {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    width: 84px;
    height: 84px;
    border-radius: 50%;
    border: 0;
    cursor: pointer;
    font-size: 12px;
    font-weight: 650;
    color: var(--text);
    transition: transform 0.2s cubic-bezier(0.3, 1.6, 0.5, 1);
  }
  .ctl:active {
    transform: scale(0.92);
  }
  .ctl.stop {
    background: linear-gradient(180deg, color-mix(in srgb, var(--red-bright) 85%, white), var(--red-bright));
    color: #fff;
    box-shadow: 0 10px 24px -10px var(--red-bright), inset 0 1px 0 rgba(255, 255, 255, 0.5);
  }
  .quick {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 10px;
  }
  .qbtn {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 52px;
    padding: 8px 12px;
    border: 0;
    border-radius: var(--r-md);
    background: color-mix(in srgb, var(--c, #8e8e93) 14%, var(--glass-thin));
    box-shadow: inset 0 1px 0 var(--glass-rim), inset 0 0 0 0.5px color-mix(in srgb, var(--c, #8e8e93) 30%, transparent);
    color: var(--text);
    font-weight: 600;
    font-size: 15px;
    text-align: left;
    cursor: pointer;
    min-width: 0;
    transition: transform 0.18s cubic-bezier(0.3, 1.6, 0.5, 1);
  }
  .qbtn:active {
    transform: scale(0.96);
  }
  .qicon {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: var(--c, var(--fill-2));
    color: #fff;
    flex: none;
  }
  .qbtn.other .qicon {
    background: var(--fill-2);
    color: var(--text);
  }
  .tl {
    display: flex;
    flex-direction: column;
  }
  .tl-row {
    display: grid;
    grid-template-columns: 48px 14px 1fr auto;
    align-items: stretch;
    gap: 10px;
    padding: 6px 4px;
    border: 0;
    background: none;
    text-align: left;
    cursor: pointer;
    border-radius: 12px;
    min-height: 52px;
    color: inherit;
  }
  .tl-row:hover {
    background: var(--fill);
  }
  .tl-time {
    font-size: 13px;
    line-height: 1.35;
    padding-top: 2px;
  }
  .tl-line {
    position: relative;
  }
  .tl-line::before {
    content: '';
    position: absolute;
    left: 50%;
    top: 4px;
    bottom: 4px;
    width: 6px;
    transform: translateX(-50%);
    border-radius: 6px;
    background: var(--c, var(--fill-2));
  }
  .gap .tl-line::before {
    background: repeating-linear-gradient(180deg, color-mix(in srgb, var(--red-bright) 45%, transparent) 0 4px, transparent 4px 8px);
  }
  .tl-body {
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-width: 0;
  }
  .tl-cat {
    display: flex;
    align-items: center;
    gap: 4px;
    font-weight: 600;
    font-size: 15px;
  }
  .gap .tl-cat {
    color: var(--red);
    font-weight: 550;
  }
  .tl-note {
    font-size: 13px;
    color: var(--text-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tl-dur {
    align-self: center;
    font-weight: 600;
    font-size: 15px;
  }
  .tl-dur.live {
    color: var(--green);
  }
  .summary {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 20px;
    flex-wrap: wrap;
  }
  .big {
    font-size: 20px;
    font-weight: 700;
  }
  .kinds {
    flex: 1;
    min-width: 136px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .kinds div {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 15px;
  }
  .kinds i {
    width: 10px;
    height: 10px;
    border-radius: 3px;
  }
  .kinds .hatch {
    background: repeating-linear-gradient(135deg, transparent 0 2px, var(--red-bright) 2px 4px);
  }
  .kinds span {
    flex: 1;
    color: var(--text-2);
  }
  .kpis {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .kpis div {
    display: flex;
    flex-direction: column;
  }
  .kpis b {
    font-size: 22px;
  }
  .plain-row {
    padding: 0;
    background: none;
  }
  .plain-row:hover {
    background: none;
  }
  .overdue {
    color: var(--red);
  }
</style>
