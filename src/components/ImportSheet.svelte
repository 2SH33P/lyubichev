<script lang="ts">
  import { FileUp } from '@lucide/svelte';
  import Sheet from './Sheet.svelte';
  import Seg from './Seg.svelte';
  import { app, externalChanged, getRepo } from '../lib/app.svelte';
  import { buildEntriesFromCsv, CSV_FIELDS, guessMapping, parseCsv, type CsvField, type CsvMapping, type CsvImportResult } from '../lib/csv';
  import { t } from '../lib/i18n/index.svelte';
  import { applyImport, EncryptedFileError, parseBackupText, previewImport, type ImportMode, type ImportPreview } from '../lib/importExport';
  import { NewerSchemaError } from '../lib/migrations';
  import { TABLES, type BackupFile } from '../lib/types';
  import { promptDialog, report, toast, confirmDialog } from '../lib/ui.svelte';
  import { createVersion } from '../lib/versions';

  let { open = $bindable(false) }: { open?: boolean } = $props();

  let fileName = $state('');
  let kind = $state<'json' | 'csv' | null>(null);
  let backup = $state.raw<BackupFile | null>(null);
  let invalid = $state(0);
  let mode = $state<ImportMode>('merge');
  let preview = $state.raw<ImportPreview | null>(null);
  let rows = $state.raw<string[][]>([]);
  let mapping = $state<CsvMapping>({});
  let busy = $state(false);

  function reset() {
    fileName = '';
    kind = null;
    backup = null;
    preview = null;
    rows = [];
    mapping = {};
    invalid = 0;
  }

  async function onFile(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = '';
    if (!f) return;
    reset();
    fileName = f.name;
    const text = await f.text();
    try {
      if (/\.csv$|\.tsv$|\.txt$/i.test(f.name) || !text.trim().startsWith('{')) {
        rows = parseCsv(text);
        if (rows.length < 2) throw new Error(t('import.emptyCsv'));
        mapping = guessMapping(rows[0]);
        kind = 'csv';
      } else {
        let password: string | undefined;
        let res;
        try {
          res = await parseBackupText(text);
        } catch (err) {
          if (!(err instanceof EncryptedFileError)) throw err;
          password = (await promptDialog({ title: t('import.password'), password: true })) ?? undefined;
          if (!password) return reset();
          res = await parseBackupText(text, password);
        }
        backup = res.backup;
        invalid = res.invalid;
        kind = 'json';
      }
    } catch (err) {
      reset();
      if (err instanceof NewerSchemaError) toast(t('import.newer'), 'error');
      else toast(t('import.failed', { msg: (err as Error).message }), 'error');
    }
  }

  $effect(() => {
    if (kind === 'json' && backup) previewImport(getRepo(), backup, mode).then((p) => (preview = p));
  });

  const csvResult = $derived.by((): CsvImportResult | null => {
    if (kind !== 'csv') return null;
    return buildEntriesFromCsv(rows, $state.snapshot(mapping), app.categories, app.entries, getRepo().deviceId);
  });

  async function apply() {
    busy = true;
    try {
      if (kind === 'json' && backup) {
        if (mode === 'overwrite' && !(await confirmDialog({ title: t('import.overwriteConfirm'), message: t('import.overwriteHint'), okText: t('import.overwrite'), danger: true }))) return;
        await applyImport(getRepo(), backup, mode);
      } else if (csvResult) {
        await createVersion(getRepo(), 'pre-import');
        const repo = getRepo();
        if (csvResult.newCategories.length) await repo.put('categories', csvResult.newCategories, 'import');
        if (csvResult.entries.length) await repo.put('entries', csvResult.entries, 'import');
      }
      await externalChanged();
      toast(t('import.done'), 'success');
      open = false;
      reset();
    } catch (e) {
      report(e);
    } finally {
      busy = false;
    }
  }

  const fieldLabel = (f: CsvField) => t('csv.' + f);
</script>

<Sheet bind:open title={t('import.title')} size="lg" onclose={reset}>
  <label class="drop glass-thin">
    <FileUp size={26} />
    <b>{fileName || t('import.choose')}</b>
    <span class="small muted">{t('import.formats')}</span>
    <input type="file" accept=".json,.csv,.tsv,.txt,application/json,text/csv" onchange={onFile} />
  </label>

  {#if kind === 'json' && backup}
    <div class="field" style="margin-top:16px">
      <span>{t('import.mode')}</span>
      <Seg block bind:value={mode} options={[{ value: 'merge', label: t('import.merge') }, { value: 'overwrite', label: t('import.overwrite') }]} />
      <div class="small muted" style="padding-left:4px">{t('import.modeHint.' + mode)}</div>
    </div>
    {#if preview}
      <table class="tbl">
        <thead><tr><th></th><th>{t('import.add')}</th><th>{t('import.update')}</th><th>{t('import.skip')}</th>{#if mode === 'overwrite'}<th>{t('import.remove')}</th>{/if}</tr></thead>
        <tbody>
          {#each TABLES as tb (tb)}
            <tr><td>{t('table.' + tb)}</td><td class="num">{preview.tables[tb].add}</td><td class="num">{preview.tables[tb].update}</td><td class="num">{preview.tables[tb].skip}</td>{#if mode === 'overwrite'}<td class="num">{preview.tables[tb].remove}</td>{/if}</tr>
          {/each}
        </tbody>
      </table>
    {/if}
    {#if invalid}<div class="small warn">{t('import.invalid', { n: invalid })}</div>{/if}
  {/if}

  {#if kind === 'csv'}
    <div class="label" style="margin:16px 0 8px">{t('import.mapping')}</div>
    <div class="map">
      {#each CSV_FIELDS as f (f)}
        <label class="field">
          <span>{fieldLabel(f)}</span>
          <select class="input" bind:value={mapping[f]}>
            <option value={undefined}>—</option>
            {#each rows[0] as h, i (i)}<option value={i}>{h || `#${i + 1}`}</option>{/each}
          </select>
        </label>
      {/each}
    </div>
    <div class="small muted">{t('import.mappingHint')}</div>
    <div class="scroll">
      <table class="tbl">
        <thead><tr>{#each rows[0] as h, i (i)}<th>{h}</th>{/each}</tr></thead>
        <tbody>{#each rows.slice(1, 6) as r, i (i)}<tr>{#each r as c, j (j)}<td>{c}</td>{/each}</tr>{/each}</tbody>
      </table>
    </div>
    {#if csvResult}
      <div class="result">
        <span class="badge primary">{t('import.csvEntries', { n: csvResult.entries.length })}</span>
        {#if csvResult.newCategories.length}<span class="badge">{t('import.csvCats', { n: csvResult.newCategories.length })}</span>{/if}
        {#if csvResult.duplicates}<span class="badge">{t('import.csvDup', { n: csvResult.duplicates })}</span>{/if}
        {#if csvResult.errors.length}<span class="badge red">{t('import.csvErr', { n: csvResult.errors.length, rows: csvResult.errors.slice(0, 5).map((e) => e.row).join(', ') })}</span>{/if}
      </div>
    {/if}
  {/if}

  {#snippet footer()}
    <button class="btn" onclick={() => (open = false)}>{t('common.cancel')}</button>
    <button class="btn primary" onclick={apply} disabled={busy || !kind || (kind === 'csv' && !csvResult?.entries.length)}>{t('import.apply')}</button>
  {/snippet}
</Sheet>

<style>
  .drop {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 26px 16px;
    border-radius: var(--r-lg);
    cursor: pointer;
    text-align: center;
    color: var(--text-2);
    border: 1.5px dashed var(--fill-2);
  }
  .drop b {
    color: var(--text);
  }
  .drop input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }
  .map {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 0 10px;
  }
  .map .field {
    margin-bottom: 10px;
  }
  .scroll {
    overflow-x: auto;
    margin-top: 12px;
    border-radius: 12px;
    background: var(--fill);
  }
  .tbl {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
    margin-top: 12px;
  }
  .scroll .tbl {
    margin: 0;
  }
  .tbl th,
  .tbl td {
    padding: 6px 8px;
    text-align: left;
    border-top: 0.5px solid var(--hairline);
    white-space: nowrap;
  }
  .tbl th {
    color: var(--text-2);
    font-weight: 600;
    border-top: 0;
  }
  .result {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 14px;
  }
  .warn {
    color: var(--orange);
    margin-top: 8px;
  }
</style>
