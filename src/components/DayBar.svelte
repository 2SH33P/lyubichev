<script lang="ts">
  import { app } from '../lib/app.svelte';
  import { activeIntervals, fmtTime, HOUR } from '../lib/time';
  import type { Entry } from '../lib/types';

  let { day, entries, gaps = [] }: { day: number; entries: Entry[]; gaps?: [number, number][] } = $props();
  const end = $derived(day + 24 * HOUR);
  const pct = (t: number) => ((Math.min(Math.max(t, day), end) - day) / (24 * HOUR)) * 100;
  const blocks = $derived(
    entries.flatMap((e) =>
      activeIntervals(e, app.now).map(([a, b]) => ({ id: e.id, a, b, color: app.idx.get(e.categoryId)?.color ?? '#8e8e93', running: e.end === null }))
    )
  );
  const nowPct = $derived(app.now >= day && app.now < end ? pct(app.now) : -1);
</script>

<div class="daybar" role="img" aria-label="timeline">
  <div class="track">
    {#each gaps as [a, b] (a)}<i class="gap" style="left:{pct(a)}%;width:{pct(b) - pct(a)}%"></i>{/each}
    {#each blocks as bl, i (bl.id + i)}
      <i class="blk" class:running={bl.running} style="left:{pct(bl.a)}%;width:{Math.max(0.3, pct(bl.b) - pct(bl.a))}%;--c:{bl.color}" title="{fmtTime(bl.a)}–{fmtTime(bl.b)}"></i>
    {/each}
    {#if nowPct >= 0}<i class="now" style="left:{nowPct}%"></i>{/if}
  </div>
  <div class="hours">
    {#each [0, 6, 12, 18, 24] as h (h)}<span style="left:{(h / 24) * 100}%">{h}</span>{/each}
  </div>
</div>

<style>
  .daybar {
    padding: 4px 0 18px;
  }
  .track {
    position: relative;
    height: 26px;
    border-radius: 9px;
    background: var(--fill);
    overflow: hidden;
  }
  .blk,
  .gap,
  .now {
    position: absolute;
    top: 0;
    bottom: 0;
  }
  .blk {
    background: var(--c);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.4);
  }
  .blk.running {
    animation: pulse 2s ease-in-out infinite;
  }
  .gap {
    background: repeating-linear-gradient(135deg, transparent 0 4px, color-mix(in srgb, var(--red-bright) 30%, transparent) 4px 6px);
  }
  .now {
    width: 2px;
    background: var(--red-bright);
    border-radius: 2px;
  }
  .hours {
    position: relative;
    height: 0;
  }
  .hours span {
    position: absolute;
    top: 4px;
    transform: translateX(-50%);
    font-size: 11px;
    color: var(--text-3);
  }
  .hours span:first-child { transform: none; }
  .hours span:last-child { transform: translateX(-100%); }
  @keyframes pulse {
    50% { opacity: 0.65; }
  }
</style>
