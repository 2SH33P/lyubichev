<script lang="ts">
  import { Cloud, RefreshCw, KeyRound, ShieldCheck, ShieldOff, Unplug, Wrench, ChevronDown } from '@lucide/svelte';
  import Seg from './Seg.svelte';
  import { app, saveSyncConfig } from '../lib/app.svelte';
  import { t } from '../lib/i18n/index.svelte';
  import { changeEncryption, compactNow, connect, describeError, disconnect, inspectRemote, isConfigured, probe, resetLocalSyncState, runSync, syncStatus, unlock } from '../lib/sync/manager.svelte';
  import { fmtDateTime, fmtTime } from '../lib/time';
  import type { SyncConfig } from '../lib/types';
  import { confirmDialog, promptDialog, toast } from '../lib/ui.svelte';
  import { createVersion } from '../lib/versions';
  import { getRepo } from '../lib/app.svelte';

  const REGIONS = ['ap-beijing', 'ap-shanghai', 'ap-guangzhou', 'ap-chengdu', 'ap-chongqing', 'ap-nanjing', 'ap-hongkong', 'ap-singapore', 'ap-tokyo', 'ap-seoul', 'ap-bangkok', 'ap-jakarta', 'ap-mumbai', 'na-siliconvalley', 'na-ashburn', 'eu-frankfurt', 'sa-saopaulo'];

  let form = $state<SyncConfig>({ ...$state.snapshot(app.sync) });
  let editing = $state(!app.sync.enabled);
  let pw1 = $state('');
  let pw2 = $state('');
  let busy = $state('');
  let showCors = $state(false);
  let showAdvanced = $state(false);

  const origin = typeof location !== 'undefined' ? location.origin : 'https://<user>.github.io';
  const corsXml = $derived(
    `AllowedOrigin: ${origin}\nAllowedMethods: GET, PUT, HEAD, DELETE\nAllowedHeaders: *\nExposeHeaders: ETag, x-cos-request-id\nMaxAgeSeconds: 600`
  );
  const appid = $derived((form.bucket.match(/-(\d+)$/) || [])[1] || '<APPID>');
  const camPolicy = $derived(
    JSON.stringify(
      {
        version: '2.0',
        statement: [
          {
            effect: 'allow',
            action: ['name/cos:GetObject', 'name/cos:PutObject', 'name/cos:DeleteObject', 'name/cos:HeadObject', 'name/cos:GetBucket'],
            resource: [`qcs::cos:${form.region || '<region>'}:uid/${appid}:${form.bucket || '<bucket-appid>'}/${(form.prefix || 'lyubishchev').replace(/\/+$/, '')}/*`, `qcs::cos:${form.region || '<region>'}:uid/${appid}:${form.bucket || '<bucket-appid>'}/`]
          }
        ]
      },
      null,
      2
    )
  );

  async function run<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
    busy = label;
    try {
      return await fn();
    } catch (e) {
      toast(describeError(e), 'error');
    } finally {
      busy = '';
    }
  }

  async function saveForm() {
    await saveSyncConfig({ ...$state.snapshot(form), enabled: app.sync.enabled });
  }

  async function test() {
    await saveForm();
    if (!isConfigured()) return toast(t('sync.fillRequired'), 'error');
    await run('test', async () => {
      await probe();
      const meta = await inspectRemote();
      toast(meta ? t('sync.testOkExisting', { enc: meta.encrypted ? t('sync.encrypted') : t('sync.plain') }) : t('sync.testOkEmpty'), 'success');
    });
  }

  async function enable() {
    await saveForm();
    if (!isConfigured()) return toast(t('sync.fillRequired'), 'error');
    await run('enable', async () => {
      const meta = await inspectRemote();
      let password: string | undefined;
      if (meta?.encrypted) {
        const p = pw1 || (await promptDialog({ title: t('sync.enterPassword'), message: t('sync.enterPasswordHint'), password: true }));
        if (!p) return;
        password = p;
      } else if (!meta && form.encrypt) {
        if (pw1.length < 6) return toast(t('sync.pwTooShort'), 'error');
        if (pw1 !== pw2) return toast(t('sync.pwMismatch'), 'error');
        password = pw1;
      }
      await connect(password);
      pw1 = pw2 = '';
      editing = false;
      toast(meta ? t('sync.joined') : t('sync.created'), 'success');
    });
  }

  async function doUnlock() {
    const p = await promptDialog({ title: t('sync.enterPassword'), message: t('sync.enterPasswordHint'), password: true });
    if (!p) return;
    await run('unlock', () => unlock(p));
  }

  async function toggleEncryption() {
    const enable = !app.sync.encrypt;
    let password: string | undefined;
    if (enable) {
      const p1 = await promptDialog({ title: t('sync.newPassword'), message: t('sync.newPasswordHint'), password: true });
      if (!p1) return;
      if (p1.length < 6) return toast(t('sync.pwTooShort'), 'error');
      const p2 = await promptDialog({ title: t('sync.confirmPassword'), password: true });
      if (p1 !== p2) return toast(t('sync.pwMismatch'), 'error');
      password = p1;
    } else if (!(await confirmDialog({ title: t('sync.disableEncConfirm'), message: t('sync.disableEncHint'), okText: t('sync.disableEnc'), danger: true }))) return;
    await run('enc', async () => {
      await createVersion(getRepo(), 'pre-encryption');
      await changeEncryption(enable, password);
      toast(enable ? t('sync.encEnabled') : t('sync.encDisabled'), 'success');
    });
  }

  async function changePassword() {
    const p1 = await promptDialog({ title: t('sync.newPassword'), message: t('sync.newPasswordHint'), password: true });
    if (!p1) return;
    if (p1.length < 6) return toast(t('sync.pwTooShort'), 'error');
    const p2 = await promptDialog({ title: t('sync.confirmPassword'), password: true });
    if (p1 !== p2) return toast(t('sync.pwMismatch'), 'error');
    await run('enc', async () => {
      await changeEncryption(true, p1);
      toast(t('sync.pwChanged'), 'success');
    });
  }

  async function doDisconnect() {
    if (!(await confirmDialog({ title: t('sync.disconnectConfirm'), message: t('sync.disconnectHint'), okText: t('sync.disconnect'), danger: true }))) return;
    await disconnect();
    editing = true;
  }

  async function redownload() {
    await run('reset', async () => {
      await resetLocalSyncState();
      await runSync('manual');
      toast(t('sync.redownloaded'), 'success');
    });
  }

  function copy(text: string) {
    navigator.clipboard?.writeText(text).then(() => toast(t('common.copied'), 'success'));
  }
</script>

{#if app.sync.enabled && !editing}
  <div class="list glass">
    <div class="row">
      <span class="ico"><Cloud size={18} /></span>
      <span class="grow">
        <b>{t('sync.phase.' + syncStatus.phase)}</b>
        <span class="sub" style="display:block">
          {syncStatus.message ?? (syncStatus.lastSync ? t('sync.last', { t: fmtDateTime(syncStatus.lastSync) }) : t('sync.never'))}{app.pending ? ' · ' + t('sync.pending', { n: app.pending }) : ''}
        </span>
      </span>
      {#if syncStatus.phase === 'need-password'}
        <button class="btn small primary" onclick={doUnlock} disabled={!!busy}><KeyRound size={15} />{t('sync.unlock')}</button>
      {:else}
        <button class="btn small primary" onclick={() => runSync('manual')} disabled={syncStatus.phase === 'syncing'}><RefreshCw size={15} class={syncStatus.phase === 'syncing' ? 'spin' : ''} />{t('sync.now')}</button>
      {/if}
    </div>
    <div class="row">
      <span class="grow">{t('sync.target')}<span class="sub" style="display:block">{app.sync.provider === 'cos' ? `COS · ${app.sync.bucket} · ${app.sync.region}` : `S3 · ${app.sync.endpoint} · ${app.sync.bucket}`} · /{app.sync.prefix}</span></span>
      <button class="btn small" onclick={() => ((form = { ...$state.snapshot(app.sync) }), (editing = true))}>{t('common.edit')}</button>
    </div>
    <label class="row">
      <span class="grow">{t('sync.auto')}<span class="sub" style="display:block">{t('sync.autoHint')}</span></span>
      <input type="checkbox" class="switch" checked={app.sync.autoSync} onchange={(e) => saveSyncConfig({ autoSync: (e.target as HTMLInputElement).checked })} />
    </label>
    <div class="row">
      <span class="ico" class:on={app.sync.encrypt}>{#if app.sync.encrypt}<ShieldCheck size={18} />{:else}<ShieldOff size={18} />{/if}</span>
      <span class="grow">{app.sync.encrypt ? t('sync.encOn') : t('sync.encOff')}<span class="sub" style="display:block">{t('sync.encHint')}</span></span>
      {#if app.sync.encrypt}<button class="btn small" onclick={changePassword} disabled={!!busy}>{t('sync.changePw')}</button>{/if}
      <button class="btn small" onclick={toggleEncryption} disabled={!!busy}>{app.sync.encrypt ? t('sync.disableEnc') : t('sync.enableEnc')}</button>
    </div>
  </div>

  <button class="disclosure" onclick={() => (showAdvanced = !showAdvanced)}><Wrench size={15} />{t('sync.advanced')}<ChevronDown size={15} style="transform:rotate({showAdvanced ? 180 : 0}deg)" /></button>
  {#if showAdvanced}
    <div class="list glass">
      <div class="row"><span class="grow">{t('sync.compact')}<span class="sub" style="display:block">{t('sync.compactHint')}</span></span><button class="btn small" onclick={() => run('compact', compactNow)} disabled={!!busy}>{t('sync.run')}</button></div>
      <div class="row"><span class="grow">{t('sync.redownload')}<span class="sub" style="display:block">{t('sync.redownloadHint')}</span></span><button class="btn small" onclick={redownload} disabled={!!busy}>{t('sync.run')}</button></div>
      <div class="row"><span class="grow">{t('sync.disconnect')}<span class="sub" style="display:block">{t('sync.disconnectHint')}</span></span><button class="btn small danger" onclick={doDisconnect}><Unplug size={15} />{t('sync.disconnect')}</button></div>
    </div>
    {#if syncStatus.log.length}
      <div class="list-header">{t('sync.log')}</div>
      <div class="list glass log">
        {#each syncStatus.log as l (l.at + l.text)}<div class="row small" class:err={l.error}><span class="num faint">{fmtTime(l.at)}</span><span class="grow">{l.text}</span></div>{/each}
      </div>
    {/if}
  {/if}
{:else}
  <div class="card glass">
    <div class="field">
      <span>{t('sync.provider')}</span>
      <Seg block bind:value={form.provider} options={[{ value: 'cos', label: t('sync.cos') }, { value: 's3', label: t('sync.s3') }]} />
    </div>
    {#if form.provider === 'cos'}
      <div class="grid-2 stack-sm" style="margin-bottom:14px">
        <label class="field"><span>{t('sync.bucket')}</span><input bind:value={form.bucket} placeholder="mybucket-1250000000" autocapitalize="off" spellcheck="false" /></label>
        <label class="field"><span>{t('sync.region')}</span><input bind:value={form.region} list="cos-regions" placeholder="ap-guangzhou" autocapitalize="off" spellcheck="false" /></label>
      </div>
      <datalist id="cos-regions">{#each REGIONS as r (r)}<option value={r}></option>{/each}</datalist>
    {:else}
      <label class="field"><span>{t('sync.endpoint')}</span><input bind:value={form.endpoint} placeholder="https://s3.amazonaws.com" autocapitalize="off" spellcheck="false" /></label>
      <div class="grid-2 stack-sm" style="margin-bottom:14px">
        <label class="field"><span>{t('sync.bucket')}</span><input bind:value={form.bucket} autocapitalize="off" spellcheck="false" /></label>
        <label class="field"><span>{t('sync.region')}</span><input bind:value={form.region} placeholder="us-east-1 / auto" autocapitalize="off" spellcheck="false" /></label>
      </div>
      <label class="row inline"><span class="grow">{t('sync.pathStyle')}</span><input type="checkbox" class="switch" bind:checked={form.pathStyle} /></label>
    {/if}
    <label class="field"><span>{t('sync.prefix')}</span><input bind:value={form.prefix} placeholder="lyubishchev" autocapitalize="off" spellcheck="false" /></label>
    <div class="grid-2 stack-sm" style="margin-bottom:14px">
      <label class="field"><span>{form.provider === 'cos' ? 'SecretId' : 'Access Key ID'}</span><input bind:value={form.accessKeyId} autocomplete="off" autocapitalize="off" spellcheck="false" /></label>
      <label class="field"><span>{form.provider === 'cos' ? 'SecretKey' : 'Secret Access Key'}</span><input type="password" bind:value={form.secretAccessKey} autocomplete="new-password" /></label>
    </div>
    <div class="small muted keyhint">{t('sync.keyHint')}</div>

    {#if !app.sync.enabled}
      <label class="row inline"><span class="grow">{t('sync.encryptNew')}<span class="sub" style="display:block">{t('sync.encryptNewHint')}</span></span><input type="checkbox" class="switch" bind:checked={form.encrypt} /></label>
      {#if form.encrypt}
        <div class="grid-2 stack-sm" style="margin-bottom:14px">
          <label class="field"><span>{t('sync.password')}</span><input type="password" bind:value={pw1} autocomplete="new-password" /></label>
          <label class="field"><span>{t('sync.confirmPassword')}</span><input type="password" bind:value={pw2} autocomplete="new-password" /></label>
        </div>
        <div class="small warn">{t('sync.pwWarning')}</div>
      {/if}
    {/if}

    <div class="toolbar" style="margin-top:16px">
      <button class="btn" onclick={test} disabled={!!busy}>{busy === 'test' ? t('common.working') : t('sync.test')}</button>
      {#if app.sync.enabled}
        <button class="btn" onclick={() => (editing = false)}>{t('common.cancel')}</button>
        <button class="btn primary" onclick={enable} disabled={!!busy}>{t('sync.reconnect')}</button>
      {:else}
        <button class="btn primary" onclick={enable} disabled={!!busy}>{busy === 'enable' ? t('common.working') : t('sync.enable')}</button>
      {/if}
    </div>
  </div>

  <button class="disclosure" onclick={() => (showCors = !showCors)}><Wrench size={15} />{t('sync.setupGuide')}<ChevronDown size={15} style="transform:rotate({showCors ? 180 : 0}deg)" /></button>
  {#if showCors}
    <div class="card glass guide">
      <ol>
        <li>{t('sync.guide1')}</li>
        <li>
          {t('sync.guide2')}
          <pre>{corsXml}</pre>
          <button class="btn small" onclick={() => copy(corsXml)}>{t('common.copy')}</button>
        </li>
        <li>
          {t('sync.guide3')}
          <pre>{camPolicy}</pre>
          <button class="btn small" onclick={() => copy(camPolicy)}>{t('common.copy')}</button>
        </li>
        <li>{t('sync.guide4')}</li>
      </ol>
    </div>
  {/if}
{/if}

<style>
  .ico {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 10px;
    background: var(--fill);
    color: var(--text-2);
    flex: none;
  }
  .ico.on {
    background: color-mix(in srgb, var(--green-bright) 18%, transparent);
    color: var(--green);
  }
  .inline {
    padding: 4px 4px 14px;
    min-height: 0;
  }
  .keyhint {
    margin: -4px 4px 14px;
  }
  .warn {
    color: var(--orange);
    margin: -4px 4px 0;
  }
  .disclosure {
    display: flex;
    align-items: center;
    gap: 6px;
    border: 0;
    background: none;
    color: var(--accent);
    font-weight: 600;
    font-size: 14px;
    padding: 16px 18px 8px;
    cursor: pointer;
    min-height: 44px;
  }
  .guide ol {
    margin: 0;
    padding-left: 20px;
    line-height: 1.6;
    font-size: 14px;
  }
  .guide li + li {
    margin-top: 12px;
  }
  pre {
    font-family: var(--mono);
    font-size: 12px;
    background: var(--fill);
    padding: 10px 12px;
    border-radius: 10px;
    overflow-x: auto;
    margin: 8px 0;
    white-space: pre;
  }
  .log .row {
    min-height: 36px;
    gap: 10px;
  }
  .log .err {
    color: var(--red);
  }
</style>
