<script lang="ts">
  import { getRepo, restoreFromHistory } from '../lib/app.svelte';
  import { t } from '../lib/i18n/index.svelte';
  import { fmtDateTime } from '../lib/time';
  import type { HistoryItem, TableName } from '../lib/types';
  import { confirmDialog, report, toast } from '../lib/ui.svelte';

  let { table, recordId, describe, onrestored }: { table: TableName; recordId: string; describe: (d: any) => string; onrestored?: () => void } = $props();
  let items = $state<HistoryItem[]>([]);
  let loaded = $state(false);

  $effect(() => {
    getRepo()
      .historyOf(table, recordId)
      .then((h) => {
        items = h;
        loaded = true;
      });
  });

  async function restore(h: HistoryItem) {
    if (!(await confirmDialog({ title: t('history.restoreConfirm'), okText: t('history.restore') }))) return;
    try {
      await restoreFromHistory(table, h.data);
      toast(t('history.restored'), 'success');
      onrestored?.();
    } catch (e) {
      report(e);
    }
  }
</script>

<div class="glass-thin list">
  {#if loaded && !items.length}
    <div class="empty small">{t('history.empty')}</div>
  {/if}
  {#each items as h (h.id)}
    <div class="row">
      <div class="grow">
        <div class="small"><b>{fmtDateTime(h.at)}</b> · <span class="badge" class:red={h.reason === 'conflict'}>{t('history.reason.' + h.reason)}</span></div>
        <div class="sub ellipsis">{describe(h.data)}</div>
      </div>
      <button class="btn small" onclick={() => restore(h)}>{t('history.restore')}</button>
    </div>
  {/each}
</div>
