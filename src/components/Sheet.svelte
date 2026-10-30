<script lang="ts">
  import type { Snippet } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { X } from '@lucide/svelte';
  import { t } from '../lib/i18n/index.svelte';

  let {
    open = $bindable(false),
    title = '',
    onclose,
    children,
    footer,
    actions,
    size = 'md'
  }: {
    open?: boolean;
    title?: string;
    onclose?: () => void;
    children: Snippet;
    footer?: Snippet;
    actions?: Snippet;
    size?: 'sm' | 'md' | 'lg';
  } = $props();

  let panel = $state<HTMLElement>();
  const mobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 719px)').matches;

  function close() {
    open = false;
    onclose?.();
  }

  function onkey(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) {
      e.stopPropagation();
      close();
    }
  }

  $effect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    queueMicrotask(() => panel?.focus());
    return () => {
      document.body.style.overflow = '';
      prev?.focus?.();
    };
  });
</script>

<svelte:window onkeydown={onkey} />

{#if open}
  <div class="backdrop" transition:fade={{ duration: 200 }} onclick={close} role="presentation"></div>
  <div class="wrap" role="presentation">
    <div
      class="panel glass-strong {size}"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      tabindex="-1"
      bind:this={panel}
      transition:fly={mobile ? { y: 500, duration: 340, opacity: 1 } : { y: 24, duration: 240 }}
    >
      <div class="grabber" aria-hidden="true"></div>
      <header>
        <button class="icon-btn small" onclick={close} aria-label={t('common.close')}><X size={18} /></button>
        <h2>{title}</h2>
        <div class="actions">{@render actions?.()}</div>
      </header>
      <div class="body">{@render children()}</div>
      {#if footer}<footer>{@render footer()}</footer>{/if}
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 80;
    background: rgba(0, 0, 0, 0.28);
    -webkit-backdrop-filter: blur(3px);
    backdrop-filter: blur(3px);
  }
  .wrap {
    position: fixed;
    inset: 0;
    z-index: 81;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    pointer-events: none;
  }
  .panel {
    pointer-events: auto;
    width: 100%;
    max-height: calc(100dvh - var(--safe-top) - 24px);
    display: flex;
    flex-direction: column;
    border-radius: var(--r-xl) var(--r-xl) 0 0;
    outline: none;
    box-shadow: var(--shadow-lg), inset 0 1px 0 var(--glass-rim);
  }
  .grabber {
    width: 38px;
    height: 5px;
    border-radius: 99px;
    background: var(--fill-2);
    margin: 8px auto 0;
  }
  header {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 8px;
    padding: 8px 14px 6px;
  }
  header h2 {
    font-size: 17px;
    font-weight: 650;
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
  }
  .body {
    overflow-y: auto;
    padding: 10px 20px 20px;
    overscroll-behavior: contain;
  }
  footer {
    display: flex;
    gap: 10px;
    padding: 12px 20px calc(14px + var(--safe-bottom));
    border-top: 0.5px solid var(--hairline);
  }
  footer :global(.btn) {
    flex: 1;
  }
  footer :global(.btn.danger) {
    flex: 0 0 auto;
  }
  @media (min-width: 720px) {
    .wrap {
      align-items: center;
      padding: 24px;
    }
    .panel {
      max-width: 560px;
      border-radius: var(--r-xl);
      max-height: calc(100dvh - 64px);
    }
    .panel.sm { max-width: 420px; }
    .panel.lg { max-width: 760px; }
    .grabber { display: none; }
    header { padding-top: 14px; }
    footer { padding-bottom: 16px; }
  }
</style>
