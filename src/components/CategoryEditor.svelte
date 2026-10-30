<script lang="ts">
  import { Trash2, History } from '@lucide/svelte';
  import Sheet from './Sheet.svelte';
  import Seg from './Seg.svelte';
  import CategorySelect from './CategorySelect.svelte';
  import HistoryList from './HistoryList.svelte';
  import { app, deleteCategory, saveCategory, ActionError } from '../lib/app.svelte';
  import { t } from '../lib/i18n/index.svelte';
  import type { Category } from '../lib/types';
  import { confirmDialog, report, toast, ui } from '../lib/ui.svelte';

  const COLORS = ['#5e5ce6', '#0a84ff', '#30b0c7', '#32ade6', '#34c759', '#30d158', '#a2845e', '#ffcc00', '#ff9f0a', '#ff6b22', '#ff3b30', '#ff375f', '#bf5af2', '#8e8e93'];
  let open = $state(false);
  let draft = $state<Category | null>(null);
  let isNew = $state(false);
  let showHistory = $state(false);

  $effect(() => {
    const req = ui.category;
    if (!req) return;
    draft = req.category;
    isNew = req.isNew;
    showHistory = false;
    open = true;
    ui.category = null;
  });

  const exclude = $derived(draft && !isNew ? app.idx.descendants(draft.id) : []);
  const usage = $derived(draft ? app.entries.filter((e) => e.categoryId === draft!.id).length : 0);

  async function save() {
    if (!draft) return;
    try {
      await saveCategory({ ...draft, name: draft.name.trim() });
      open = false;
    } catch (e) {
      if (e instanceof ActionError) toast(e.message, 'error');
      else report(e);
    }
  }

  async function remove() {
    if (!draft) return;
    if (!(await confirmDialog({ title: t('cat.deleteConfirm', { name: draft.name }), okText: t('common.delete'), danger: true }))) return;
    try {
      await deleteCategory(draft.id);
      open = false;
    } catch (e) {
      if (e instanceof ActionError) toast(e.message, 'error');
      else report(e);
    }
  }
</script>

<Sheet bind:open title={isNew ? t('cat.new') : t('cat.edit')}>
  {#snippet actions()}
    {#if !isNew}<button class="icon-btn small" class:primary={showHistory} onclick={() => (showHistory = !showHistory)} aria-label={t('history.title')}><History size={17} /></button>{/if}
  {/snippet}
  {#if draft}
    {#if showHistory}
      <HistoryList table="categories" recordId={draft.id} describe={(d) => d.name} onrestored={() => (open = false)} />
      <div class="hr"></div>
    {/if}
    <label class="field"><span>{t('cat.name')}</span><input bind:value={draft.name} placeholder={t('cat.namePh')} /></label>
    <label class="field"><span>{t('cat.parent')}</span><CategorySelect bind:value={draft.parentId} allowEmpty emptyLabel={t('cat.topLevel')} {exclude} /></label>
    <div class="field">
      <span>{t('cat.kind')}</span>
      <Seg
        block
        bind:value={draft.kind}
        options={[
          { value: 'primary', label: t('kind.primary') },
          { value: 'secondary', label: t('kind.secondary') },
          { value: 'life', label: t('kind.life') }
        ]}
        onchange={(v) => (draft!.countAsWork = v !== 'life')}
      />
      <div class="small muted" style="padding-left:4px">{t('cat.kindHint.' + draft.kind)}</div>
    </div>
    <div class="field">
      <span>{t('cat.color')}</span>
      <div class="colors">
        {#each COLORS as c (c)}
          <button class="sw" class:on={draft.color === c} style="--c:{c}" onclick={() => (draft!.color = c)} aria-label={c}></button>
        {/each}
        <input type="color" bind:value={draft.color} aria-label={t('cat.custom')} />
      </div>
    </div>
    <div class="glass-thin list" style="margin-bottom:14px">
      <label class="row">
        <span class="grow">{t('cat.countAsWork')}<div class="sub">{t('cat.countAsWorkHint')}</div></span>
        <input type="checkbox" class="switch" bind:checked={draft.countAsWork} />
      </label>
      <label class="row">
        <span class="grow">{t('cat.archived')}<div class="sub">{t('cat.archivedHint')}</div></span>
        <input type="checkbox" class="switch" bind:checked={draft.archived} />
      </label>
    </div>
    <label class="field"><span>{t('cat.unit')}</span><input bind:value={draft.unit} placeholder={t('entry.unitPh')} /></label>
    {#if !isNew}<div class="small muted">{t('cat.usage', { n: usage })}</div>{/if}
  {/if}
  {#snippet footer()}
    {#if !isNew}<button class="btn danger" onclick={remove}><Trash2 size={17} />{t('common.delete')}</button>{/if}
    <button class="btn primary" onclick={save}>{t('common.save')}</button>
  {/snippet}
</Sheet>

<style>
  .colors {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
  }
  .sw {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: 0;
    background: var(--c);
    cursor: pointer;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5);
    transition: transform 0.15s;
  }
  .sw.on {
    box-shadow: 0 0 0 3px var(--bg), 0 0 0 5px var(--c);
  }
  .sw:active {
    transform: scale(0.9);
  }
  input[type='color'] {
    width: 36px;
    height: 36px;
    border: 0;
    padding: 0;
    background: none;
    cursor: pointer;
  }
</style>
