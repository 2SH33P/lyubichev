<script lang="ts">
  import { app } from '../lib/app.svelte';
  import { t } from '../lib/i18n/index.svelte';

  let {
    value = $bindable(),
    allowEmpty = false,
    emptyLabel = '',
    exclude = [] as string[],
    id = undefined as string | undefined,
    includeArchived = false
  }: { value: string | null; allowEmpty?: boolean; emptyLabel?: string; exclude?: string[]; id?: string; includeArchived?: boolean } = $props();

  const items = $derived(app.idx.flatten(includeArchived).filter((x) => !exclude.includes(x.cat.id)));
</script>

<select {id} class="input" bind:value>
  {#if allowEmpty}<option value={null}>{emptyLabel || t('common.none')}</option>{/if}
  {#each items as { cat, depth } (cat.id)}
    <option value={cat.id}>{'\u00a0\u00a0\u00a0'.repeat(depth)}{depth ? '└ ' : ''}{cat.name}</option>
  {/each}
</select>
