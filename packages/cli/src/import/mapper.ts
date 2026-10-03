import { join } from 'node:path';
import { createClient, type ShapioClient } from '@shapio/client';
import { createRateLimitedFetch } from '../helpers/rateLimitRetry.js';
import type { CliIo } from '../types.js';
import { addToChangeSets, changeSetUrl, pendingPublishItems } from './changeSets.js';
import { localeKey, readImportMap, sha256File, writeImportMap, type ImportMap } from './importMap.js';
import { importMedia } from './media.js';
import { writeOrder } from './order.js';
import { PLAN_LOCK_FILE, PLAN_SCHEMA_DIR } from './planner.js';
import { formatWarnings } from './report.js';
import type { ConversionWarning, ImportEntry, ImportSource, ValueResolver } from './types.js';
import { buildData, resolveLiveSchema, type BuildContext, type LiveSchema } from './values.js';

/**
 * `--map`: runs a plan against an instance whose schema has the planned models. Uploads media, creates every
 * entry as a draft (referenced entries first, cycles closed by a second write), then puts the entries that were
 * published at the source into change sets for review. Every step is recorded in `import-map.json`, so a
 * re-run skips what is done and retries what failed. Nothing is published.
 */
export type MapOptions = {
  dir: string;
  baseUrl: string;
  token: string;
  site?: string;
  /** "WordPress", "Strapi": change set titles and messages. */
  label: string;
  /** Re-reads the source (the map records where it is). */
  load: (map: ImportMap) => Promise<ImportSource>;
  fetch?: typeof globalThis.fetch;
};

type Run = {
  options: MapOptions;
  io: CliIo;
  map: ImportMap;
  client: ShapioClient;
  live: LiveSchema;
  warnings: ConversionWarning[];
  save: () => Promise<void>;
};

export class ImportRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportRefusedError';
  }
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const checkSourceAndSite = async (map: ImportMap, options: MapOptions) => {
  const sha256 = await sha256File(map.source.path).catch((error: unknown) => {
    throw new ImportRefusedError(`The source ${map.source.path} cannot be read: ${messageOf(error)}`);
  });
  if (sha256 !== map.source.sha256) {
    throw new ImportRefusedError(
      `${map.source.path} changed since it was planned: plan again into a new directory`,
    );
  }
  const started = Object.keys(map.state.entries).length > 0 || Object.keys(map.state.media).length > 0;
  if (started && (map.state.site ?? null) !== (options.site ?? null)) {
    throw new ImportRefusedError(
      `This import was started on site ${map.state.site ?? '(default)'}: re-run it with the same --site`,
    );
  }
};

const loadLiveSchema = async (client: ShapioClient, map: ImportMap, dir: string) => {
  const exported = await client.admin.schema.export();
  const live = resolveLiveSchema(
    map,
    exported.definitions.map((entry) => entry.definition),
  );
  if (live.missing.length > 0) {
    throw new ImportRefusedError(
      `The instance does not have the planned models yet: ${live.missing.join(', ')}.\n` +
        `Apply them first: shapio schema apply --dir ${join(dir, PLAN_SCHEMA_DIR)} --lock ${join(dir, PLAN_LOCK_FILE)}`,
    );
  }
  return live;
};

const checkLocales = async (client: ShapioClient, source: ImportSource) => {
  const needed = new Set(
    source.entries.flatMap((entry) =>
      entry.locales.flatMap((locale) => (locale.locale ? [locale.locale] : [])),
    ),
  );
  if (needed.size === 0) {
    return;
  }
  const available = new Set((await client.admin.locales.list()).map((locale) => locale.code));
  const missing = [...needed].filter((code) => !available.has(code));
  if (missing.length > 0) {
    throw new ImportRefusedError(
      `The instance does not have these locales: ${missing.join(', ')}. Add them (Settings → Locales), then re-run.`,
    );
  }
};

const resolverOf = (map: ImportMap): ValueResolver => ({
  media: (sourceId) => map.state.media[sourceId]?.assetId,
  entry: (sourceId) => map.state.entries[sourceId]?.entryId,
});

const fail = (run: Run, sourceId: string, error: unknown) => {
  run.map.state.failed[sourceId] = messageOf(error);
};

const succeed = async (run: Run, sourceId: string) => {
  delete run.map.state.failed[sourceId];
  await run.save();
};

const uploadAll = async (run: Run, source: ImportSource) => {
  const pending = source.media.filter((media) => !run.map.state.media[media.sourceId]);
  if (pending.length > 0) {
    run.io.stdout(`Uploading ${pending.length} media file(s)...\n`);
  }
  const context = {
    client: run.client,
    baseUrl: run.options.baseUrl,
    cacheDir: join(run.options.dir, 'media'),
    fetch: run.options.fetch ?? globalThis.fetch,
    warnings: run.warnings,
  };
  for (const media of pending) {
    try {
      run.map.state.media[media.sourceId] = { assetId: await importMedia(media, context) };
      await succeed(run, media.sourceId);
    } catch (error) {
      fail(run, media.sourceId, error);
    }
  }
};

const buildContext = (run: Run): BuildContext => ({
  live: run.live,
  resolver: resolverOf(run.map),
  warnings: run.warnings,
});

/** Creates the entry in its first locale, then adds its other locales; resumes a partly written entry. */
const writeEntry = async (run: Run, entry: ImportEntry, deferred: ReadonlySet<string> | undefined) => {
  const view = run.live.byKey.get(entry.definition);
  if (!view) {
    return;
  }
  const modelKey = view.definition.apiKey;
  const context = buildContext(run);
  for (const [index, locale] of entry.locales.entries()) {
    const created = run.map.state.entries[entry.sourceId];
    const key = localeKey(locale.locale);
    if (created?.locales.includes(key)) {
      continue;
    }
    const data = buildData(locale.fields, view, context, {
      ...(deferred ? { omit: deferred } : {}),
      localizedOnly: index > 0,
    });
    const localeInput = locale.locale ? { locale: locale.locale } : {};
    if (!created) {
      const result = await run.client.admin.content.create(modelKey, { ...localeInput, data });
      run.map.state.entries[entry.sourceId] = { entryId: result.id, locales: [key], complete: !deferred };
    } else {
      await run.client.admin.content.update(modelKey, created.entryId, {
        ...localeInput,
        expectedVersion: null,
        data,
      });
      created.locales.push(key);
    }
    await run.save();
  }
};

/** The second write of entries whose references closed a cycle: only the deferred fields, per locale. */
const writeDeferred = async (run: Run, entry: ImportEntry, fields: ReadonlySet<string>) => {
  const created = run.map.state.entries[entry.sourceId];
  const view = run.live.byKey.get(entry.definition);
  if (!created || created.complete || !view) {
    return;
  }
  const modelKey = view.definition.apiKey;
  for (const [index, locale] of entry.locales.entries()) {
    const localeInput = locale.locale ? { locale: locale.locale } : {};
    const data = buildData(locale.fields, view, buildContext(run), {
      only: fields,
      localizedOnly: index > 0,
    });
    if (Object.keys(data).length === 0) {
      continue;
    }
    const current = await run.client.admin.content.get(modelKey, created.entryId, localeInput);
    await run.client.admin.content.update(modelKey, created.entryId, {
      ...localeInput,
      expectedVersion: current.version,
      data,
    });
  }
  created.complete = true;
  await run.save();
};

const writeEntries = async (run: Run, source: ImportSource) => {
  const order = writeOrder(source.entries);
  const pending = order.entries.filter((entry) => {
    const created = run.map.state.entries[entry.sourceId];
    return !created || created.locales.length < entry.locales.length || !created.complete;
  });
  if (pending.length > 0) {
    run.io.stdout(`Writing ${pending.length} entr${pending.length === 1 ? 'y' : 'ies'} as drafts...\n`);
  }
  for (const entry of pending) {
    try {
      await writeEntry(run, entry, order.deferred.get(entry.sourceId));
      await succeed(run, entry.sourceId);
    } catch (error) {
      fail(run, entry.sourceId, error);
    }
  }
  for (const entry of pending) {
    const fields = order.deferred.get(entry.sourceId);
    if (!fields || run.map.state.failed[entry.sourceId]) {
      continue;
    }
    try {
      await writeDeferred(run, entry, fields);
    } catch (error) {
      fail(run, entry.sourceId, error);
    }
  }
};

const openChangeSets = async (run: Run) => {
  const { pending, total } = pendingPublishItems(run.map, run.live);
  if (pending.length === 0) {
    return { added: 0, failed: [] };
  }
  run.io.stdout(
    `Adding ${pending.length} published entr${pending.length === 1 ? 'y' : 'ies'} to change sets...\n`,
  );
  return addToChangeSets(run.client, run.map, pending, { label: run.options.label, total, save: run.save });
};

const printSummary = (run: Run, source: ImportSource, changeSetFailures: number) => {
  const { state } = run.map;
  const drafts = Object.values(run.map.entries).filter((entry) => entry.published.length === 0).length;
  const failures = Object.entries(state.failed);
  run.io.stdout(
    `Media: ${Object.keys(state.media).length}/${source.media.length} uploaded. ` +
      `Entries: ${Object.keys(state.entries).length}/${source.entries.length} created ` +
      `(${drafts} stay drafts: they were not published in ${run.options.label}).\n`,
  );
  for (const set of state.changeSets) {
    run.io.stdout(`Change set "${set.title}": ${changeSetUrl(run.options.baseUrl, set.id, state.site)}\n`);
  }
  run.io.stdout(formatWarnings(run.warnings));
  for (const [sourceId, message] of failures.slice(0, 20)) {
    run.io.stderr(`  ! ${sourceId}: ${message}\n`);
  }
  if (failures.length > 0 || changeSetFailures > 0) {
    run.io.stderr(
      `${failures.length + changeSetFailures} item(s) failed (see above). Fix the cause and re-run the same command: done items are skipped.\n`,
    );
    return 1;
  }
  return 0;
};

export const runMap = async (options: MapOptions, io: CliIo): Promise<number> => {
  const map = await readImportMap(options.dir);
  await checkSourceAndSite(map, options);
  const client = createClient({
    baseUrl: options.baseUrl,
    token: options.token,
    fetch: createRateLimitedFetch(options.fetch),
    ...(options.site ? { site: options.site } : {}),
  });
  const live = await loadLiveSchema(client, map, options.dir);
  const source = await options.load(map);
  await checkLocales(client, source);
  map.state.site = options.site ?? null;
  map.state.baseUrl = options.baseUrl;
  const run: Run = {
    options,
    io,
    map,
    client,
    live,
    warnings: [],
    save: () => writeImportMap(options.dir, map),
  };
  await run.save();
  await uploadAll(run, source);
  await writeEntries(run, source);
  const changeSets = await openChangeSets(run);
  for (const failure of changeSets.failed) {
    io.stderr(`  ! change set item ${failure.key}: ${failure.message}\n`);
  }
  return printSummary(run, source, changeSets.failed.length);
};
