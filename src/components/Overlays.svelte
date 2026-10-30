<script lang="ts">
  import { fly } from 'svelte/transition';
  import Sheet from './Sheet.svelte';
  import { app } from '../lib/app.svelte';
  import { t } from '../lib/i18n/index.svelte';
  import { ui } from '../lib/ui.svelte';
  import { CircleCheck, CircleAlert, Info } from '@lucide/svelte';

  let confirmOpen = $state(false);
  let promptOpen = $state(false);
  let pickerOpen = $state(false);
  let promptValue = $state('');
  let filter = $state('');

  $effect(() => {
    if (ui.confirm) confirmOpen = true;
  });
  $effect(() => {
    if (ui.prompt) {
      promptValue = ui.prompt.value ?? '';
      promptOpen = true;
    }
  });
  $effect(() => {
    if (ui.picker) {
      filter = '';
      pickerOpen = true;
    }
  });

  function endConfirm(v: boolean) {
    ui.confirm?.resolve(v);
    ui.confirm = null;
    confirmOpen = false;
  }
  function endPrompt(v: string | null) {
    ui.prompt?.resolve(v);
    ui.prompt = null;
    promptOpen = false;
  }
  function endPicker(v: string | null) {
    ui.picker?.resolve(v);
    ui.picker = null;
    pickerOpen = false;
  }
  const items = $derived(app.idx.flatten(false).filter((x) => !filter || app.idx.pathName(x.cat.id).toLowerCase().includes(filter.toLowerCase())));
</script>

<Sheet bind:open={confirmOpen} title={ui.confirm?.title ?? ''} size="sm" onclose={() => endConfirm(false)}>
  {#if ui.confirm?.message}<p class="msg">{ui.confirm.message}</p>{/if}
  {#snippet footer()}
    <button class="btn" onclick={() => endConfirm(false)}>{ui.confirm?.cancelText ?? t('common.cancel')}</button>
    <button class="btn {ui.confirm?.danger ? 'danger filled' : 'primary'}" style="flex:1" onclick={() => endConfirm(true)}>{ui.confirm?.okText ?? t('common.ok')}</button>
  {/snippet}
</Sheet>

<Sheet bind:open={promptOpen} title={ui.prompt?.title ?? ''} size="sm" onclose={() => endPrompt(null)}>
  {#if ui.prompt?.message}<p class="msg">{ui.prompt.message}</p>{/if}
  <form
    onsubmit={(e) => {
      e.preventDefault();
      endPrompt(promptValue);
    }}
  >
    <!-- svelte-ignore a11y_autofocus -->
    <input class="input" type={ui.prompt?.password ? 'password' : 'text'} autocomplete={ui.prompt?.password ? 'current-password' : 'off'} bind:value={promptValue} placeholder={ui.prompt?.placeholder ?? ''} autofocus />
  </form>
  {#snippet footer()}
    <button class="btn" onclick={() => endPrompt(null)}>{t('common.cancel')}</button>
    <button class="btn primary" onclick={() => endPrompt(promptValue)}>{ui.prompt?.okText ?? t('common.ok')}</button>
  {/snippet}
</Sheet>

<Sheet bind:open={pickerOpen} title={ui.picker?.title ?? ''} onclose={() => endPicker(null)}>
  <input class="input" bind:value={filter} placeholder={t('common.search')} style="margin-bottom:12px" />
  <div class="glass-thin list">
    {#each items as { cat, depth } (cat.id)}
      <button class="row row-btn" style="padding-left:{18 + depth * 22}px" onclick={() => endPicker(cat.id)}>
        <span class="dot" style="--c:{cat.color}"></span>
        <span class="grow">{cat.name}</span>
        <span class="badge {cat.kind}">{t('kind.' + cat.kind)}</span>
      </button>
    {/each}
  </div>
</Sheet>

<div class="toasts" aria-live="polite">
  {#each ui.toasts as tt (tt.id)}
    <div class="toast glass-strong {tt.kind}" transition:fly={{ y: -30, duration: 260 }}>
      {#if tt.kind === 'success'}<CircleCheck size={18} />{:else if tt.kind === 'error'}<CircleAlert size={18} />{:else}<Info size={18} />{/if}
      <span>{tt.text}</span>
      {#if tt.action}<button class="btn small plain" onclick={() => { tt.action!.run(); ui.toasts = ui.toasts.filter((x) => x.id !== tt.id); }}>{tt.action.label}</button>{/if}
    </div>
  {/each}
</div>

<style>
  .msg {
    margin: 0 0 8px;
    color: var(--text-2);
    line-height: 1.55;
  }
  .toasts {
    position: fixed;
    top: calc(var(--safe-top) + 12px);
    left: 0;
    right: 0;
    z-index: 100;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    pointer-events: none;
    padding: 0 16px;
  }
  .toast {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: 520px;
    min-height: 48px;
    padding: 8px 18px;
    border-radius: 999px;
    font-size: 15px;
    font-weight: 550;
  }
  .toast.success :global(svg) {
    color: var(--green);
  }
  .toast.error :global(svg) {
    color: var(--red);
  }
  .toast.info :global(svg) {
    color: var(--accent);
  }
</style>
