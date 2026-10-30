<script lang="ts">
  import { Plus, ChevronUp, ChevronDown, Archive } from '@lucide/svelte';
  import { app, moveCategory, newCategoryDraft } from '../lib/app.svelte';
  import { t } from '../lib/i18n/index.svelte';
  import { fmtHours, netMs } from '../lib/time';
  import { editCategory } from '../lib/ui.svelte';

  let showArchived = $state(false);
  const rows = $derived(app.idx.flatten(showArchived));
  const totals = $derived.by(() => {
    const m = new Map<string, number>();
    for (const e of app.entries) for (const c of app.idx.path(e.categoryId)) m.set(c.id, (m.get(c.id) || 0) + netMs(e, app.now));
    return m;
  });
  const archivedCount = $derived(app.categories.filter((c) => c.archived).length);
</script>

<div class="page narrow">
  <header class="page-header">
    <div>
      <h1>{t('nav.categories')}</h1>
      <div class="subtitle">{t('cat.subtitle')}</div>
    </div>
    <button class="btn primary" onclick={() => editCategory(newCategoryDraft(), true)}><Plus size={18} />{t('cat.new')}</button>
  </header>

  <div class="kinds">
    {#each ['primary', 'secondary', 'life'] as k (k)}
      <div class="kind glass-thin"><span class="badge {k}">{t('kind.' + k)}</span><span class="small muted">{t('cat.kindHint.' + k)}</span></div>
    {/each}
  </div>

  <div class="list glass">
    {#each rows as { cat, depth } (cat.id)}
      <div class="row" style="padding-left:{18 + depth * 24}px" class:archived={cat.archived}>
        <button class="grow main" onclick={() => editCategory(cat)}>
          <span class="dot" style="--c:{cat.color}"></span>
          <span class="name ellipsis" class:top={depth === 0}>{cat.name}</span>
          {#if depth === 0}<span class="badge kb {cat.kind}">{t('kind.' + cat.kind)}</span>{/if}
          {#if !cat.countAsWork && cat.kind !== 'life'}<span class="badge">{t('cat.notWork')}</span>{/if}
          {#if cat.archived}<Archive size={14} class="faint" />{/if}
          <span class="spacer"></span>
          <span class="num small muted nowrap">{fmtHours(totals.get(cat.id) || 0)}h</span>
        </button>
        <button class="icon-btn small plain" onclick={() => moveCategory(cat.id, -1)} aria-label={t('cat.moveUp')}><ChevronUp size={16} /></button>
        <button class="icon-btn small plain" onclick={() => moveCategory(cat.id, 1)} aria-label={t('cat.moveDown')}><ChevronDown size={16} /></button>
        <button class="icon-btn small plain" onclick={() => editCategory(newCategoryDraft(cat.id), true)} aria-label={t('cat.addChild')}><Plus size={16} /></button>
      </div>
    {/each}
  </div>
  {#if archivedCount}
    <div style="text-align:center;margin-top:14px">
      <button class="btn small" onclick={() => (showArchived = !showArchived)}>{showArchived ? t('cat.hideArchived') : t('cat.showArchived', { n: archivedCount })}</button>
    </div>
  {/if}
</div>

<style>
  .nowrap {
    white-space: nowrap;
  }
  @media (max-width: 480px) {
    .kb {
      display: none;
    }
  }
  .narrow {
    max-width: 820px;
  }
  .kinds {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
    margin-bottom: 16px;
  }
  .kind {
    border-radius: var(--r-md);
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: flex-start;
  }
  @media (max-width: 600px) {
    .kinds {
      grid-template-columns: 1fr;
    }
    .kind {
      flex-direction: row;
      align-items: center;
    }
  }
  .row {
    gap: 2px;
    padding-right: 8px;
  }
  .main {
    display: flex;
    align-items: center;
    gap: 10px;
    border: 0;
    background: none;
    padding: 6px 0;
    text-align: left;
    cursor: pointer;
    color: inherit;
    min-width: 0;
  }
  .name {
    font-size: 15px;
  }
  .name.top {
    font-weight: 650;
  }
  .archived {
    opacity: 0.55;
  }
</style>
