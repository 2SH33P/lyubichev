<script lang="ts">
  import { Target, NotebookPen, FolderTree, Settings, History, ChevronRight, Cloud } from '@lucide/svelte';
  import { app } from '../lib/app.svelte';
  import { t } from '../lib/i18n/index.svelte';
  import { syncStatus, runSync } from '../lib/sync/manager.svelte';
  import { fmtDateTime } from '../lib/time';

  const items = [
    { href: '#/plans', icon: Target, key: 'nav.plans', hint: 'more.plans', color: '#ff9f0a' },
    { href: '#/reviews', icon: NotebookPen, key: 'nav.reviews', hint: 'more.reviews', color: '#5e5ce6' },
    { href: '#/categories', icon: FolderTree, key: 'nav.categories', hint: 'more.categories', color: '#34c759' },
    { href: '#/versions', icon: History, key: 'nav.versions', hint: 'more.versions', color: '#30b0c7' },
    { href: '#/settings', icon: Settings, key: 'nav.settings', hint: 'more.settings', color: '#8e8e93' }
  ];
</script>

<div class="page narrow">
  <header class="page-header"><h1>{t('nav.more')}</h1></header>

  {#if app.sync.enabled}
    <button class="card glass sync" onclick={() => runSync('manual')}>
      <span class="ico" style="--c:#0a84ff"><Cloud size={20} /></span>
      <span class="grow">
        <b>{t('sync.title')} · {t('sync.phase.' + syncStatus.phase)}</b>
        <span class="sub">{syncStatus.message ?? (syncStatus.lastSync ? t('sync.last', { t: fmtDateTime(syncStatus.lastSync) }) : t('sync.never'))}</span>
      </span>
      <span class="btn small">{t('sync.now')}</span>
    </button>
  {/if}

  <div class="list glass">
    {#each items as it (it.href)}
      <a class="row row-btn" href={it.href}>
        <span class="ico" style="--c:{it.color}"><it.icon size={19} /></span>
        <span class="grow"><span>{t(it.key)}</span><span class="sub">{t(it.hint)}</span></span>
        <ChevronRight size={18} class="faint" />
      </a>
    {/each}
  </div>
</div>

<style>
  .narrow {
    max-width: 720px;
  }
  .ico {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: 10px;
    background: var(--c);
    color: #fff;
    flex: none;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.4);
  }
  .grow {
    display: flex;
    flex-direction: column;
  }
  .row {
    color: var(--text);
  }
  .sync {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    border: 0;
    text-align: left;
    color: inherit;
    cursor: pointer;
    margin-bottom: 16px;
  }
</style>
