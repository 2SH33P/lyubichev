<script lang="ts">
  import { app } from '../lib/app.svelte';
  let { id, full = false, onclick }: { id: string | null | undefined; full?: boolean; onclick?: () => void } = $props();
  const cat = $derived(id ? app.idx.get(id) : undefined);
  const label = $derived(cat ? (full ? app.idx.pathName(cat.id) : cat.name) : '?');
</script>

{#if onclick}
  <button class="chip" style="--c:{cat?.color ?? '#8e8e93'}" {onclick} title={id ? app.idx.pathName(id) : ''}>
    <span class="dot"></span><span class="ellipsis">{label}</span>
  </button>
{:else}
  <span class="chip" style="--c:{cat?.color ?? '#8e8e93'}" title={id ? app.idx.pathName(id) : ''}>
    <span class="dot"></span><span class="ellipsis">{label}</span>
  </span>
{/if}
