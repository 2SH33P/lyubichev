<script lang="ts">
  import { fmtHours, HOUR } from '../lib/time';
  let {
    labels,
    series,
    height = 180,
    target = 0,
    highlight = -1
  }: {
    labels: string[];
    series: { name: string; color: string; values: number[] }[];
    height?: number;
    target?: number;
    highlight?: number;
  } = $props();

  const totals = $derived(labels.map((_, i) => series.reduce((s, x) => s + (x.values[i] || 0), 0)));
  const max = $derived(Math.max(HOUR, target, ...totals) * 1.08);
  const step = $derived(max > 12 * HOUR * 20 ? 50 * HOUR : max > 40 * HOUR ? 10 * HOUR : max > 10 * HOUR ? 4 * HOUR : max > 4 * HOUR ? 2 * HOUR : HOUR);
  const ticks = $derived(Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step));
  const showEvery = $derived(labels.length > 16 ? Math.ceil(labels.length / 10) : 1);
</script>

<div class="chart" style="--h:{height}px">
  <div class="axis">
    {#each ticks as tk (tk)}
      <span style="bottom:{(tk / max) * 100}%">{fmtHours(tk).replace('.0', '')}h</span>
    {/each}
  </div>
  <div class="plot">
    {#each ticks as tk (tk)}<i class="grid" style="bottom:{(tk / max) * 100}%"></i>{/each}
    {#if target}<i class="target" style="bottom:{(target / max) * 100}%"></i>{/if}
    <div class="bars" style="grid-template-columns: repeat({labels.length}, minmax(0, 1fr))">
      {#each labels as lb, i (i)}
        <div class="col" class:hl={i === highlight} title="{lb}: {fmtHours(totals[i])}h">
          <div class="bstack">
            {#each series as s (s.name)}
              {#if s.values[i]}
                <i style="height:{(s.values[i] / max) * 100}%; background:{s.color}"></i>
              {/if}
            {/each}
          </div>
          <span class="lb">{i % showEvery === 0 ? lb : ''}</span>
        </div>
      {/each}
    </div>
  </div>
</div>
<div class="legend">
  {#each series as s (s.name)}<span><i style="background:{s.color}"></i>{s.name}</span>{/each}
</div>

<style>
  .chart {
    display: grid;
    grid-template-columns: 34px 1fr;
    height: calc(var(--h) + 22px);
  }
  .axis {
    position: relative;
    height: var(--h);
  }
  .axis span {
    position: absolute;
    right: 6px;
    transform: translateY(50%);
    font-size: 11px;
    color: var(--text-3);
    font-variant-numeric: tabular-nums;
  }
  .plot {
    position: relative;
    height: var(--h);
  }
  .grid,
  .target {
    position: absolute;
    left: 0;
    right: 0;
    height: 0;
    border-top: 0.5px solid var(--hairline);
  }
  .target {
    border-top: 1.5px dashed var(--red-bright);
    opacity: 0.7;
  }
  .bars {
    position: absolute;
    inset: 0;
    display: grid;
    gap: 3px;
  }
  .col {
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    height: 100%;
    min-width: 0;
  }
  .bstack {
    display: flex;
    flex-direction: column-reverse;
    height: 100%;
    justify-content: flex-start;
    border-radius: 6px;
    overflow: hidden;
    width: min(100%, 26px);
    margin: 0 auto;
  }
  .bstack i {
    display: block;
    flex: none;
    transition: height 0.5s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .col.hl .bstack {
    box-shadow: 0 0 0 2px var(--accent);
  }
  .lb {
    position: absolute;
    top: 100%;
    left: 50%;
    transform: translateX(-50%);
    margin-top: 4px;
    font-size: 11px;
    color: var(--text-2);
    white-space: nowrap;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
    margin-top: 8px;
    font-size: 13px;
    color: var(--text-2);
  }
  .legend span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .legend i {
    width: 10px;
    height: 10px;
    border-radius: 3px;
  }
</style>
