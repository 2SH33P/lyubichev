<script lang="ts">
  import { Download, Upload, FileSpreadsheet, ListTodo, Lock, RefreshCw, Smartphone, HardDrive } from '@lucide/svelte';
  import Seg from '../components/Seg.svelte';
  import SyncSettings from '../components/SyncSettings.svelte';
  import ImportSheet from '../components/ImportSheet.svelte';
  import { app, getRepo, saveSettings } from '../lib/app.svelte';
  import { entriesToCsv, todosToCsv } from '../lib/csv';
  import { t } from '../lib/i18n/index.svelte';
  import { download, exportBackupJson } from '../lib/importExport';
  import { dayKey } from '../lib/time';
  import { promptDialog, report, toast, ui } from '../lib/ui.svelte';
  import type { Settings } from '../lib/types';

  let importOpen = $state(false);
  let storage = $state<{ usage: number; quota: number; persisted: boolean } | null>(null);

  $effect(() => {
    (async () => {
      const est = await navigator.storage?.estimate?.();
      const persisted = (await navigator.storage?.persisted?.()) ?? false;
      if (est) storage = { usage: est.usage || 0, quota: est.quota || 0, persisted };
    })();
  });

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => saveSettings({ [k]: v } as Partial<Settings>);

  async function exportJson(encrypt: boolean) {
    try {
      let pw: string | undefined;
      if (encrypt) {
        pw = (await promptDialog({ title: t('data.exportPassword'), message: t('data.exportPasswordHint'), password: true })) ?? undefined;
        if (!pw) return;
      }
      const json = await exportBackupJson(getRepo(), pw);
      download(`lyubishchev-backup-${dayKey(Date.now())}${encrypt ? '.encrypted' : ''}.json`, json);
      toast(t('data.exported'), 'success');
    } catch (e) {
      report(e);
    }
  }
  const mb = (n: number) => (n / 1024 / 1024).toFixed(1) + ' MB';
  const isIOS = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = typeof window !== 'undefined' && (window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone);
</script>

<div class="page narrow">
  <header class="page-header"><h1>{t('nav.settings')}</h1></header>

  <div class="list-header">{t('set.general')}</div>
  <div class="list glass">
    <div class="row"><span class="grow">{t('set.language')}</span><Seg bind:value={app.settings.lang} options={[{ value: 'zh', label: '中文' }, { value: 'en', label: 'English' }]} onchange={(v) => set('lang', v)} /></div>
    <div class="row wrap"><span class="grow">{t('set.theme')}</span><Seg bind:value={app.settings.theme} options={[{ value: 'auto', label: t('set.themeAuto') }, { value: 'light', label: t('set.themeLight') }, { value: 'dark', label: t('set.themeDark') }]} onchange={(v) => set('theme', v)} /></div>
    <label class="row"><span class="grow">{t('set.reducedGlass')}<span class="sub" style="display:block">{t('set.reducedGlassHint')}</span></span><input type="checkbox" class="switch" checked={app.settings.reducedGlass} onchange={(e) => set('reducedGlass', (e.target as HTMLInputElement).checked)} /></label>
    <div class="row"><span class="grow">{t('set.weekStart')}</span><Seg bind:value={app.settings.weekStart} options={[{ value: 1, label: t('set.monday') }, { value: 0, label: t('set.sunday') }]} onchange={(v) => set('weekStart', v)} /></div>
  </div>

  <div class="list-header">{t('set.recording')}</div>
  <div class="list glass">
    <label class="row"><span class="grow">{t('set.allowOverlap')}<span class="sub" style="display:block">{t('set.allowOverlapHint')}</span></span><input type="checkbox" class="switch" checked={app.settings.allowOverlap} onchange={(e) => set('allowOverlap', (e.target as HTMLInputElement).checked)} /></label>
    <div class="row wrap"><span class="grow">{t('set.roundTo')}<span class="sub" style="display:block">{t('set.roundToHint')}</span></span><Seg bind:value={app.settings.roundTo} options={[{ value: 1, label: t('set.noRound') }, { value: 5, label: '5m' }, { value: 10, label: '10m' }, { value: 15, label: '15m' }]} onchange={(v) => set('roundTo', v)} /></div>
    <label class="row"><span class="grow">{t('set.minEntry')}<span class="sub" style="display:block">{t('set.minEntryHint')}</span></span><input class="input mini num" type="number" min="0" max="60" value={app.settings.minEntryMin} onchange={(e) => set('minEntryMin', Math.max(0, Number((e.target as HTMLInputElement).value) || 0))} /></label>
    <div class="row wrap"><span class="grow">{t('set.gap')}<span class="sub" style="display:block">{t('set.gapHint')}</span></span><Seg bind:value={app.settings.gapMin} options={[{ value: 0, label: t('set.off') }, { value: 10, label: '10m' }, { value: 15, label: '15m' }, { value: 30, label: '30m' }]} onchange={(v) => set('gapMin', v)} /></div>
    <div class="row">
      <span class="grow">{t('set.dayWindow')}<span class="sub" style="display:block">{t('set.dayWindowHint')}</span></span>
      <input class="input mini num" type="number" min="0" max="23" value={app.settings.dayStartHour} onchange={(e) => set('dayStartHour', Number((e.target as HTMLInputElement).value) || 0)} aria-label={t('set.dayStart')} />
      <span class="faint">–</span>
      <input class="input mini num" type="number" min="1" max="24" value={app.settings.dayEndHour} onchange={(e) => set('dayEndHour', Number((e.target as HTMLInputElement).value) || 24)} aria-label={t('set.dayEnd')} />
    </div>
  </div>

  <div class="list-header">{t('sync.title')}</div>
  <SyncSettings />
  <div class="list-footer">{t('sync.footer')}</div>

  <div class="list-header">{t('set.data')}</div>
  <div class="list glass">
    <button class="row row-btn" onclick={() => exportJson(false)}><Download size={18} /><span class="grow">{t('data.exportJson')}<span class="sub" style="display:block">{t('data.exportJsonHint')}</span></span></button>
    <button class="row row-btn" onclick={() => exportJson(true)}><Lock size={18} /><span class="grow">{t('data.exportEncrypted')}</span></button>
    <button class="row row-btn" onclick={() => download(`entries-${dayKey(Date.now())}.csv`, entriesToCsv(app.entries, app.idx, app.todoById), 'text/csv;charset=utf-8')}><FileSpreadsheet size={18} /><span class="grow">{t('data.exportCsv')}</span></button>
    <button class="row row-btn" onclick={() => download(`todos-${dayKey(Date.now())}.csv`, todosToCsv(app.todos, app.idx, app.todoActual), 'text/csv;charset=utf-8')}><ListTodo size={18} /><span class="grow">{t('data.exportTodos')}</span></button>
    <button class="row row-btn" onclick={() => (importOpen = true)}><Upload size={18} /><span class="grow">{t('data.import')}<span class="sub" style="display:block">{t('data.importHint')}</span></span></button>
    <a class="row row-btn" href="#/versions"><RefreshCw size={18} /><span class="grow">{t('nav.versions')}<span class="sub" style="display:block">{t('more.versions')}</span></span></a>
  </div>

  <div class="list-header">{t('set.about')}</div>
  <div class="list glass">
    <div class="row"><span class="grow">{t('set.version')}</span><span class="muted num">v{__APP_VERSION__} · {__BUILD_TIME__.slice(0, 10)}</span></div>
    {#if storage}
      <div class="row"><HardDrive size={18} /><span class="grow">{t('set.storage')}<span class="sub" style="display:block">{storage.persisted ? t('set.persisted') : t('set.notPersisted')}</span></span><span class="muted num">{mb(storage.usage)}</span></div>
    {/if}
    {#if ui.updateReady}
      <button class="row row-btn" onclick={() => ui.updateReady?.()}><RefreshCw size={18} /><span class="grow">{t('pwa.updateReady')}</span><span class="btn small primary">{t('pwa.reload')}</span></button>
    {/if}
    {#if !standalone}
      <div class="row"><Smartphone size={18} /><span class="grow">{t('set.install')}<span class="sub" style="display:block">{isIOS ? t('set.installIOS') : t('set.installOther')}</span></span></div>
    {/if}
    <div class="row"><span class="grow sub">{t('set.device')}: <span class="num">{getRepo().deviceId}</span></span></div>
  </div>
</div>

<ImportSheet bind:open={importOpen} />

<style>
  .narrow {
    max-width: 760px;
  }
  .mini {
    width: 72px;
    min-height: 38px;
    padding: 6px 10px;
    text-align: right;
  }
  .row :global(svg) {
    flex: none;
    color: var(--text-2);
  }
  .row-btn {
    color: var(--text);
  }
  @media (max-width: 520px) {
    .row.wrap {
      flex-wrap: wrap;
    }
    .row.wrap :global(.seg) {
      width: 100%;
    }
  }
</style>
