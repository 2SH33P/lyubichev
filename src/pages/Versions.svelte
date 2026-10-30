<script lang="ts">
  import { Plus, RotateCcw, Download, CloudUpload, Trash2, Pencil, Cloud, RefreshCw } from '@lucide/svelte';
  import { app, externalChanged, getRepo } from '../lib/app.svelte';
  import { gunzipJson } from '../lib/codec';
  import { t } from '../lib/i18n/index.svelte';
  import { download } from '../lib/importExport';
  import { migrateBackup } from '../lib/migrations';
  import { deleteRemoteVersion, describeError, downloadRemoteVersion, isConfigured, listRemoteVersions, uploadVersion } from '../lib/sync/manager.svelte';
  import { fmtDateTime } from '../lib/time';
  import type { VersionMeta } from '../lib/types';
  import { confirmDialog, promptDialog, report, toast } from '../lib/ui.svelte';
  import { createVersion, deleteVersion, listVersions, loadVersion, renameVersion, restoreBackup } from '../lib/versions';

  let local = $state<VersionMeta[]>([]);
  let remote = $state<{ key: string; meta: VersionMeta }[] | null>(null);
  let remoteError = $state<string | null>(null);
  let busy = $state(false);
  const cloud = $derived(app.sync.enabled && isConfigured());

  async function refresh() {
    local = await listVersions(getRepo());
  }
  async function refreshRemote() {
    if (!cloud) return;
    try {
      remote = await listRemoteVersions();
      remoteError = null;
    } catch (e) {
      remoteError = describeError(e);
    }
  }
  $effect(() => {
    refresh();
    refreshRemote();
  });

  async function create() {
    const name = await promptDialog({ title: t('ver.createTitle'), message: t('ver.createHint'), placeholder: t('ver.namePh') });
    if (name === null) return;
    await createVersion(getRepo(), 'manual', name.trim() || null);
    toast(t('ver.created'), 'success');
    refresh();
  }

  async function restore(v: VersionMeta) {
    if (!(await confirmDialog({ title: t('ver.restoreConfirm'), message: t('ver.restoreHint', { t: fmtDateTime(v.createdAt) }), okText: t('ver.restore') }))) return;
    busy = true;
    try {
      await restoreBackup(getRepo(), await loadVersion(getRepo(), v.id));
      await externalChanged();
      toast(t('ver.restored'), 'success');
      refresh();
    } catch (e) {
      report(e);
    } finally {
      busy = false;
    }
  }

  async function exportOne(v: VersionMeta) {
    const b = await loadVersion(getRepo(), v.id);
    download(`lyubishchev-version-${v.createdAt}.json`, JSON.stringify(b));
  }

  async function upload(v: VersionMeta) {
    busy = true;
    try {
      await uploadVersion(v, await loadVersion(getRepo(), v.id));
      toast(t('ver.uploaded'), 'success');
      refreshRemote();
    } catch (e) {
      toast(describeError(e), 'error');
    } finally {
      busy = false;
    }
  }

  async function rename(v: VersionMeta) {
    const name = await promptDialog({ title: t('ver.rename'), value: v.name ?? '', placeholder: t('ver.namePh') });
    if (name === null) return;
    await renameVersion(getRepo(), v.id, name.trim() || null);
    refresh();
  }

  async function remove(v: VersionMeta) {
    if (!(await confirmDialog({ title: t('ver.deleteConfirm'), okText: t('common.delete'), danger: true }))) return;
    await deleteVersion(getRepo(), v.id);
    refresh();
  }

  async function restoreRemote(r: { key: string; meta: VersionMeta }) {
    if (!(await confirmDialog({ title: t('ver.restoreConfirm'), message: t('ver.restoreHint', { t: fmtDateTime(r.meta.createdAt) }), okText: t('ver.restore') }))) return;
    busy = true;
    try {
      const raw = await downloadRemoteVersion<unknown>(r.key);
      await restoreBackup(getRepo(), migrateBackup(raw).backup);
      await externalChanged();
      toast(t('ver.restored'), 'success');
      refresh();
    } catch (e) {
      toast(describeError(e), 'error');
    } finally {
      busy = false;
    }
  }

  async function removeRemote(r: { key: string; meta: VersionMeta }) {
    if (!(await confirmDialog({ title: t('ver.deleteRemoteConfirm'), okText: t('common.delete'), danger: true }))) return;
    await deleteRemoteVersion(r.key);
    refreshRemote();
  }

  const summary = (v: VersionMeta) => t('ver.summary', { e: v.summary.counts.entries, td: v.summary.counts.todos, h: (v.summary.totalMinutes / 60).toFixed(1) });
  void gunzipJson;
</script>

<div class="page narrow">
  <header class="page-header">
    <div>
      <h1>{t('nav.versions')}</h1>
      <div class="subtitle">{t('ver.subtitle')}</div>
    </div>
    <button class="btn primary" onclick={create}><Plus size={18} />{t('ver.create')}</button>
  </header>

  <div class="list-header">{t('ver.local')}</div>
  <div class="list glass">
    {#if !local.length}<div class="empty">{t('ver.empty')}</div>{/if}
    {#each local as v (v.id)}
      <div class="row ver">
        <div class="grow">
          <div class="title">
            <b>{v.name || fmtDateTime(v.createdAt)}</b>
            <span class="badge" class:primary={v.kind === 'manual'}>{t('ver.kind.' + v.kind)}</span>
          </div>
          <div class="sub">{v.name ? fmtDateTime(v.createdAt) + ' · ' : ''}{summary(v)}</div>
        </div>
        <div class="acts">
          <button class="icon-btn small" onclick={() => restore(v)} disabled={busy} title={t('ver.restore')} aria-label={t('ver.restore')}><RotateCcw size={16} /></button>
          <button class="icon-btn small" onclick={() => exportOne(v)} title={t('ver.download')} aria-label={t('ver.download')}><Download size={16} /></button>
          {#if cloud}<button class="icon-btn small" onclick={() => upload(v)} disabled={busy} title={t('ver.upload')} aria-label={t('ver.upload')}><CloudUpload size={16} /></button>{/if}
          <button class="icon-btn small" onclick={() => rename(v)} title={t('ver.rename')} aria-label={t('ver.rename')}><Pencil size={16} /></button>
          <button class="icon-btn small" onclick={() => remove(v)} title={t('common.delete')} aria-label={t('common.delete')}><Trash2 size={16} /></button>
        </div>
      </div>
    {/each}
  </div>
  <div class="list-footer">{t('ver.retention')}</div>

  {#if cloud}
    <div class="list-header hdr"><span><Cloud size={14} /> {t('ver.remote')}</span><button class="btn small plain" onclick={refreshRemote}><RefreshCw size={14} />{t('common.refresh')}</button></div>
    <div class="list glass">
      {#if remoteError}<div class="empty">{remoteError}</div>
      {:else if remote && !remote.length}<div class="empty">{t('ver.remoteEmpty')}</div>{/if}
      {#each remote ?? [] as r (r.key)}
        <div class="row ver">
          <div class="grow">
            <div class="title"><b>{r.meta.name || fmtDateTime(r.meta.createdAt)}</b><span class="badge">{r.meta.deviceId}</span></div>
            <div class="sub">{r.meta.name ? fmtDateTime(r.meta.createdAt) + ' · ' : ''}{summary(r.meta)}</div>
          </div>
          <div class="acts">
            <button class="icon-btn small" onclick={() => restoreRemote(r)} disabled={busy} aria-label={t('ver.restore')} title={t('ver.restore')}><RotateCcw size={16} /></button>
            <button class="icon-btn small" onclick={() => removeRemote(r)} aria-label={t('common.delete')} title={t('common.delete')}><Trash2 size={16} /></button>
          </div>
        </div>
      {/each}
    </div>
    <div class="list-footer">{t('ver.remoteHint')}</div>
  {/if}
</div>

<style>
  .narrow {
    max-width: 820px;
  }
  .ver {
    flex-wrap: wrap;
  }
  .title {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .acts {
    display: flex;
    gap: 6px;
  }
  .hdr {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .hdr span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
</style>
