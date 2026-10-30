<script lang="ts">
  import { addDays, dayKey, fmtHours, startOfDay, weekStartOf } from '../lib/time';
  let {
    year,
    values,
    weekStart = 1,
    color = 'var(--purple)'
  }: { year: number; values: Map<string, number>; weekStart?: 0 | 1; color?: string } = $props();

  const cells = $derived.by(() => {
    const first = new Date(year, 0, 1).getTime();
    const last = new Date(year, 11, 31).getTime();
    const start = weekStartOf(first, weekStart);
    const max = Math.max(1, ...[...values.values()]);
    const weeks: { key: string; v: number; level: number; inYear: boolean }[][] = [];
    for (let t = start; t <= last; t = addDays(t, 7)) {
      const w = [];
      for (let i = 0; i < 7; i++) {
        const d = startOfDay(addDays(t, i));
        const key = dayKey(d);
        const v = values.get(key) || 0;
        w.push({ key, v, level: v ? Math.min(4, Math.ceil((v / max) * 4)) : 0, inYear: new Date(d).getFullYear() === year });
      }
      weeks.push(w);
    }
    return weeks;
  });
</script>

<div class="hm" role="img" aria-label="heatmap {year}">
  {#each cells as w, i (i)}
    <div class="wk">
      {#each w as c (c.key)}
        <i class="l{c.level}" class:out={!c.inYear} style="--c:{color}" title="{c.key} · {fmtHours(c.v)}h"></i>
      {/each}
    </div>
  {/each}
</div>

<style>
  .hm {
    display: flex;
    gap: 3px;
    overflow-x: auto;
    padding-bottom: 4px;
  }
  .wk {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  i {
    width: 11px;
    height: 11px;
    border-radius: 3px;
    background: var(--fill);
  }
  i.out {
    opacity: 0;
  }
  .l1 { background: color-mix(in srgb, var(--c) 30%, transparent); }
  .l2 { background: color-mix(in srgb, var(--c) 52%, transparent); }
  .l3 { background: color-mix(in srgb, var(--c) 76%, transparent); }
  .l4 { background: var(--c); }
</style>
