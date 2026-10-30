<script lang="ts">
  import type { Snippet } from 'svelte';
  let {
    segments,
    size = 160,
    thickness = 18,
    center
  }: { segments: { value: number; color: string; label: string }[]; size?: number; thickness?: number; center?: Snippet } = $props();

  const total = $derived(segments.reduce((s, x) => s + x.value, 0));
  const r = $derived((size - thickness) / 2);
  const c = $derived(2 * Math.PI * r);
  const arcs = $derived.by(() => {
    let acc = 0;
    const gap = segments.filter((s) => s.value > 0).length > 1 ? 2 : 0;
    return segments
      .filter((s) => s.value > 0)
      .map((s) => {
        const len = total ? (s.value / total) * c : 0;
        const a = { ...s, dash: Math.max(0, len - gap), offset: -acc };
        acc += len;
        return a;
      });
  });
</script>

<div class="donut" style="width:{size}px;height:{size}px">
  <svg viewBox="0 0 {size} {size}" width={size} height={size} role="img" aria-label={segments.map((s) => s.label).join(', ')}>
    <circle cx={size / 2} cy={size / 2} {r} fill="none" stroke="var(--fill)" stroke-width={thickness} />
    {#each arcs as a (a.label)}
      <circle
        cx={size / 2}
        cy={size / 2}
        {r}
        fill="none"
        stroke={a.color}
        stroke-width={thickness}
        stroke-linecap="round"
        stroke-dasharray="{a.dash} {c}"
        stroke-dashoffset={a.offset}
        transform="rotate(-90 {size / 2} {size / 2})"
        style="transition: stroke-dasharray .6s cubic-bezier(.2,.8,.2,1), stroke-dashoffset .6s cubic-bezier(.2,.8,.2,1)"
      ><title>{a.label}</title></circle>
    {/each}
  </svg>
  {#if center}<div class="center">{@render center()}</div>{/if}
</div>

<style>
  .donut {
    position: relative;
    flex: none;
  }
  .center {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    text-align: center;
  }
</style>
