<script lang="ts">
  import { onMount } from 'svelte';
  import { Timer, ListTodo, List, ChartPie, Target, NotebookPen, FolderTree, Settings as SettingsIcon, LayoutGrid, History, Cloud, CloudOff, RefreshCw, CloudAlert, KeyRound } from '@lucide/svelte';
  import { app, initApp } from './lib/app.svelte';
  import { t } from './lib/i18n/index.svelte';
  import { router, go, type Route } from './lib/router.svelte';
  import { initSync, runSync, syncStatus } from './lib/sync/manager.svelte';
  import { ui, toast } from './lib/ui.svelte';
  import { fmtClock, netMs } from './lib/time';
  import EntryEditor from './components/EntryEditor.svelte';
  import TodoEditor from './components/TodoEditor.svelte';
  import CategoryEditor from './components/CategoryEditor.svelte';
  import Overlays from './components/Overlays.svelte';
  import Today from './pages/Today.svelte';
  import Todos from './pages/Todos.svelte';
  import Entries from './pages/Entries.svelte';
  import Stats from './pages/Stats.svelte';
  import Plans from './pages/Plans.svelte';
  import Reviews from './pages/Reviews.svelte';
  import Categories from './pages/Categories.svelte';
  import Settings from './pages/Settings.svelte';
  import Versions from './pages/Versions.svelte';
  import More from './pages/More.svelte';

  const NAV: { route: Route; icon: any; key: string }[] = [
    { route: 'today', icon: Timer, key: 'nav.today' },
    { route: 'todos', icon: ListTodo, key: 'nav.todos' },
    { route: 'entries', icon: List, key: 'nav.entries' },
    { route: 'stats', icon: ChartPie, key: 'nav.stats' },
    { route: 'plans', icon: Target, key: 'nav.plans' },
    { route: 'reviews', icon: NotebookPen, key: 'nav.reviews' },
    { route: 'categories', icon: FolderTree, key: 'nav.categories' },
    { route: 'versions', icon: History, key: 'nav.versions' },
    { route: 'settings', icon: SettingsIcon, key: 'nav.settings' }
  ];
  const TABS: { route: Route; icon: any; key: string }[] = [
    { route: 'today', icon: Timer, key: 'nav.today' },
    { route: 'todos', icon: ListTodo, key: 'nav.todos' },
    { route: 'entries', icon: List, key: 'nav.entries' },
    { route: 'stats', icon: ChartPie, key: 'nav.stats' },
    { route: 'more', icon: LayoutGrid, key: 'nav.more' }
  ];
  const MORE_ROUTES: Route[] = ['more', 'plans', 'reviews', 'categories', 'settings', 'versions'];

  let dark = $state(typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  onMount(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onMq = () => (dark = mq.matches);
    mq.addEventListener('change', onMq);
    initApp().then(() => {
      if (app.ready) initSync();
    });
    import('virtual:pwa-register')
      .then(({ registerSW }) => {
        const update = registerSW({
          onNeedRefresh() {
            ui.updateReady = () => update(true);
            toast(t('pwa.updateReady'), 'info', { label: t('pwa.reload'), run: () => update(true) }, 12000);
          },
          onOfflineReady() {
            toast(t('pwa.offlineReady'), 'success');
          }
        });
      })
      .catch(() => {});
    return () => mq.removeEventListener('change', onMq);
  });

  $effect(() => {
    const theme = app.settings.theme === 'auto' ? (dark ? 'dark' : 'light') : app.settings.theme;
    document.documentElement.dataset.theme = theme;
    if (app.settings.reducedGlass) document.documentElement.dataset.glass = 'reduced';
    else delete document.documentElement.dataset.glass;
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', theme === 'dark' ? '#000000' : '#ffffff'));
  });

  const route = $derived(router.route);
  const tabActive = (r: Route) => (r === 'more' ? MORE_ROUTES.includes(route) : route === r);
  const mini = $derived(app.running[0]);
</script>

{#if app.error}
  <div class="page"><div class="card glass"><h2>{t('app.error')}</h2><p class="muted">{app.error}</p></div></div>
{:else if !app.ready}
  <div class="splash"><div class="spinner"></div></div>
{:else}
  <div class="shell">
    <nav class="sidebar glass" aria-label={t('nav.main')}>
      <div class="brand">
        <img src="./favicon.svg" alt="" width="30" height="30" />
        <span>{t('app.short')}</span>
      </div>
      <div class="navlist">
        {#each NAV as n (n.route)}
          <a href="#/{n.route}" class="navitem" class:on={route === n.route} aria-current={route === n.route ? 'page' : undefined} title={t(n.key)}>
            <n.icon size={20} strokeWidth={2} />
            <span>{t(n.key)}</span>
          </a>
        {/each}
      </div>
      <div class="spacer"></div>
      {@render syncPill()}
    </nav>

    <main>
      {#key route}
        <div class="route">
          {#if route === 'today'}<Today />
          {:else if route === 'todos'}<Todos />
          {:else if route === 'entries'}<Entries />
          {:else if route === 'stats'}<Stats />
          {:else if route === 'plans'}<Plans />
          {:else if route === 'reviews'}<Reviews />
          {:else if route === 'categories'}<Categories />
          {:else if route === 'settings'}<Settings />
          {:else if route === 'versions'}<Versions />
          {:else if route === 'more'}<More />
          {/if}
        </div>
      {/key}
    </main>

    {#if mini && route !== 'today'}
      <button class="mini glass-strong" onclick={() => go('today')} style="--c:{app.idx.get(mini.categoryId)?.color}">
        <span class="dot"></span>
        <span class="ellipsis">{app.idx.get(mini.categoryId)?.name}</span>
        <b class="num">{fmtClock(netMs(mini, app.now))}</b>
      </button>
    {/if}

    <nav class="tabbar glass-strong" aria-label={t('nav.main')}>
      {#each TABS as n (n.route)}
        <a href="#/{n.route}" class="tab" class:on={tabActive(n.route)} aria-current={tabActive(n.route) ? 'page' : undefined}>
          <n.icon size={22} strokeWidth={tabActive(n.route) ? 2.4 : 2} />
          <span>{t(n.key)}</span>
          {#if n.route === 'more' && (syncStatus.phase === 'error' || syncStatus.phase === 'need-password')}<i class="alert"></i>{/if}
        </a>
      {/each}
    </nav>
  </div>
{/if}

{#snippet syncPill()}
  {#if app.sync.enabled}
    <button class="syncpill" onclick={() => (syncStatus.phase === 'need-password' || syncStatus.phase === 'error' ? go('settings') : runSync('manual'))} title={syncStatus.message ?? ''}>
      {#if syncStatus.phase === 'syncing'}<RefreshCw size={16} class="spin" />
      {:else if syncStatus.phase === 'error'}<CloudAlert size={16} color="var(--red)" />
      {:else if syncStatus.phase === 'need-password'}<KeyRound size={16} color="var(--orange)" />
      {:else if syncStatus.phase === 'offline'}<CloudOff size={16} />
      {:else}<Cloud size={16} />{/if}
      <span>{t('sync.phase.' + syncStatus.phase)}{app.pending && syncStatus.phase === 'idle' ? ` · ${app.pending}` : ''}</span>
    </button>
  {/if}
{/snippet}

<EntryEditor />
<TodoEditor />
<CategoryEditor />
<Overlays />

<style>
  .splash {
    position: fixed;
    inset: 0;
    display: grid;
    place-items: center;
  }
  .spinner {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    border: 3px solid var(--fill-2);
    border-top-color: var(--accent);
    animation: spin 0.9s linear infinite;
  }
  :global(.spin) {
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  .route {
    animation: enter 0.35s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  @keyframes enter {
    from { opacity: 0; transform: translateY(8px); }
  }

  /* ---------- 移动端：悬浮标签栏 ---------- */
  .sidebar {
    display: none;
  }
  .tabbar {
    position: fixed;
    z-index: 50;
    left: 50%;
    transform: translateX(-50%);
    bottom: calc(var(--safe-bottom) + 10px);
    width: min(calc(100% - 24px), 460px);
    height: var(--tabbar-h);
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    padding: 6px;
    border-radius: 999px;
    box-shadow: var(--shadow-lg), inset 0 1px 0 var(--glass-rim);
  }
  .tab {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    border-radius: 999px;
    color: var(--text-2);
    font-size: 10.5px;
    font-weight: 600;
    transition: color 0.2s, background 0.3s;
  }
  .tab.on {
    color: var(--accent);
    background: var(--fill);
    box-shadow: inset 0 1px 0 var(--glass-rim);
  }
  .tab:active {
    transform: scale(0.94);
  }
  .alert {
    position: absolute;
    top: 6px;
    right: calc(50% - 16px);
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--red-bright);
  }
  .mini {
    position: fixed;
    z-index: 49;
    left: 50%;
    transform: translateX(-50%);
    bottom: calc(var(--safe-bottom) + var(--tabbar-h) + 20px);
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: min(calc(100% - 48px), 360px);
    min-height: 44px;
    padding: 0 18px;
    border-radius: 999px;
    border: 0;
    cursor: pointer;
    font-size: 15px;
    font-weight: 600;
  }
  .mini b {
    color: var(--accent);
  }

  /* ---------- 平板与桌面：悬浮侧栏 ---------- */
  @media (min-width: 720px) {
    .tabbar,
    .mini {
      display: none;
    }
    .shell {
      display: grid;
      grid-template-columns: 84px 1fr;
      min-height: 100dvh;
    }
    .sidebar {
      position: sticky;
      top: 12px;
      margin: 12px 0 12px 12px;
      height: calc(100dvh - 24px);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      padding: 14px 10px;
      border-radius: var(--r-xl);
      z-index: 10;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 700;
      font-size: 16px;
      padding: 4px 6px 14px;
    }
    .brand span,
    .navitem span,
    .syncpill span {
      display: none;
    }
    .navlist {
      display: flex;
      flex-direction: column;
      gap: 4px;
      width: 100%;
    }
    .navitem {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      height: 46px;
      border-radius: 16px;
      color: var(--text-2);
      font-weight: 590;
      font-size: 15px;
      transition: background 0.2s, color 0.2s;
    }
    .navitem:hover {
      background: var(--fill);
      color: var(--text);
    }
    .navitem.on {
      background: var(--glass-strong);
      color: var(--accent);
      box-shadow: 0 4px 14px -6px rgba(0, 0, 0, 0.2), inset 0 1px 0 var(--glass-rim);
    }
    .syncpill {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      width: 100%;
      min-height: 40px;
      border: 0;
      border-radius: 14px;
      background: var(--fill);
      color: var(--text-2);
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }
    main {
      min-width: 0;
    }
  }
  @media (min-width: 1100px) {
    .shell {
      grid-template-columns: 248px 1fr;
    }
    .sidebar {
      align-items: stretch;
      padding: 18px 12px;
    }
    .brand span,
    .navitem span,
    .syncpill span {
      display: inline;
    }
    .navitem {
      justify-content: flex-start;
      padding: 0 14px;
    }
    .syncpill {
      justify-content: flex-start;
      padding: 0 14px;
    }
  }
</style>
