import { access, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createStableId,
  parseDefinition,
  suggestPlural,
  validateSchema,
  type JsonValue,
  type SchemaDefinition,
} from '@shapio/schema';
import { writeDefinitionFile, writeLockFile } from '../commands/schema/files.js';
import { EMPTY_LOCK } from '../commands/schema/sync.js';
import {
  emptyState,
  IMPORT_MAP_FORMAT,
  IMPORT_MAP_FORMAT_VERSION,
  importMapPath,
  readImportMap,
  writeImportMap,
  type ImportMap,
  type PlannedDefinitionIds,
} from './importMap.js';
import type { ImportSource, PlannedDefinition, PlannedField } from './types.js';

/** Where `--plan` puts the schema files and their (empty) lock file inside the plan directory. */
export const PLAN_SCHEMA_DIR = 'schema';
export const PLAN_LOCK_FILE = 'schema-lock.json';

export type SourceInfo = ImportMap['source'];

type Ids = Record<string, PlannedDefinitionIds>;

/** Fresh stable IDs for every planned definition and field (a new plan, or a throwaway build). */
export const assignIds = (definitions: readonly PlannedDefinition[]): Ids =>
  Object.fromEntries(
    definitions.map((definition) => [
      definition.key,
      {
        id: createStableId(),
        kind: definition.kind,
        apiKey: definition.apiKey,
        fields: Object.fromEntries(definition.fields.map((field) => [field.key, createStableId()])),
      },
    ]),
  );

const idOf = (ids: Ids, key: string) => {
  const planned = ids[key];
  if (!planned) {
    throw new Error(`Import plan bug: unknown definition "${key}"`);
  }
  return planned.id;
};

const fieldSettings = (field: PlannedField, ids: Ids, fieldIds: Record<string, string>) => {
  const settings: Record<string, JsonValue> = { ...field.settings };
  if (field.target) {
    settings.target = idOf(ids, field.target);
  }
  if (field.component) {
    settings.component = idOf(ids, field.component);
  }
  if (field.components) {
    settings.components = field.components.map((key) => idOf(ids, key));
  }
  const sourceFieldId = field.slugSource ? fieldIds[field.slugSource] : undefined;
  if (sourceFieldId) {
    settings.sourceFieldId = sourceFieldId;
  }
  return settings;
};

/** The schema-file form of a planned definition (the pull format, with IDs). */
const definitionInput = (definition: PlannedDefinition, ids: Ids) => {
  const planned = ids[definition.key];
  if (!planned) {
    throw new Error(`Import plan bug: unknown definition "${definition.key}"`);
  }
  const isModel = definition.kind !== 'component';
  const fields = definition.fields.map((field) => ({
    id: planned.fields[field.key],
    apiKey: field.apiKey,
    label: field.label,
    type: field.type,
    ...(isModel && definition.localized ? { localized: field.localized ?? false } : {}),
    ...(field.public === false ? { public: false } : {}),
    ...(field.unique ? { unique: true } : {}),
    ...(field.sortable ? { sortable: true } : {}),
    settings: fieldSettings(field, ids, planned.fields),
  }));
  const titleFieldId = definition.titleField ? planned.fields[definition.titleField] : undefined;
  return {
    id: planned.id,
    kind: definition.kind,
    apiKey: definition.apiKey,
    label: definition.label,
    ...(definition.description ? { description: definition.description } : {}),
    fields,
    ...(definition.kind === 'collection'
      ? { pluralApiKey: definition.pluralApiKey ?? suggestPlural(definition.apiKey) }
      : {}),
    ...(isModel ? { localized: definition.localized ?? false, draftAndPublish: true } : {}),
    ...(definition.kind === 'component' && definition.category ? { category: definition.category } : {}),
    ...(titleFieldId ? { display: { titleFieldId } } : {}),
  };
};

/** Normalized, validated definitions; throws with every issue when the plan would not apply. */
export const buildDefinitions = (source: ImportSource, ids: Ids): SchemaDefinition[] => {
  const problems: string[] = [];
  const definitions = source.definitions.flatMap((planned) => {
    const parsed = parseDefinition(definitionInput(planned, ids));
    if (!parsed.ok) {
      problems.push(...parsed.issues.map((issue) => `${planned.apiKey}${issue.path}: ${issue.message}`));
      return [];
    }
    return [parsed.definition];
  });
  if (problems.length === 0) {
    problems.push(...validateSchema(definitions).map((issue) => `${issue.path}: ${issue.message}`));
  }
  if (problems.length > 0) {
    throw new Error(`The planned schema is not valid:\n${problems.map((line) => `  ${line}`).join('\n')}`);
  }
  return definitions;
};

const exists = async (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

/** Refuses to replace a plan whose import has started, and any plan without `force`. */
export const checkPlanDirectory = async (dir: string, force: boolean) => {
  if (!(await exists(importMapPath(dir)))) {
    return;
  }
  const previous = await readImportMap(dir);
  const started =
    Object.keys(previous.state.entries).length > 0 || Object.keys(previous.state.media).length > 0;
  if (started) {
    throw new Error(
      `${dir} holds an import that has started (${Object.keys(previous.state.entries).length} entries created): re-run --map to continue it, or plan into a new directory`,
    );
  }
  if (!force) {
    throw new Error(
      `${dir} already holds a plan: pass --force to replace it (new IDs), or use another directory`,
    );
  }
};

const plannedMap = (
  source: ImportSource,
  info: SourceInfo,
  ids: Ids,
  site: string | undefined,
): ImportMap => ({
  format: IMPORT_MAP_FORMAT,
  formatVersion: IMPORT_MAP_FORMAT_VERSION,
  source: info,
  plannedAt: new Date().toISOString(),
  site: site ?? null,
  definitions: ids,
  media: Object.fromEntries(
    source.media.map((media) => [
      media.sourceId,
      {
        filename: media.filename,
        ...(media.url ? { url: media.url } : {}),
        ...(media.path ? { path: media.path } : {}),
      },
    ]),
  ),
  entries: Object.fromEntries(
    source.entries.map((entry) => [
      entry.sourceId,
      {
        definition: entry.definition,
        title: entry.title,
        locales: entry.locales.map((locale) => locale.locale),
        published: entry.locales.filter((locale) => locale.published).map((locale) => locale.locale),
      },
    ]),
  ),
  state: emptyState(),
});

/**
 * `--plan`: writes one pull-format schema file per planned definition under `<dir>/schema`, an empty lock file
 * beside them (so `schema apply` treats every definition as new and leaves the project's own lock alone), and
 * `import-map.json`. Nothing is sent to an instance. With `site` (`--site` / SHAPIO_SITE) the files go under
 * `schema/sites/<site>/`, so `schema apply --site <site>` creates them on that site; without one they go in
 * the shared folders and are created shared with all sites.
 */
export const writePlan = async (
  dir: string,
  source: ImportSource,
  info: SourceInfo,
  { force = false, site }: { force?: boolean; site?: string | undefined } = {},
): Promise<{ definitions: SchemaDefinition[]; map: ImportMap }> => {
  await checkPlanDirectory(dir, force);
  const ids = assignIds(source.definitions);
  const definitions = buildDefinitions(source, ids);
  const schemaDir = join(dir, PLAN_SCHEMA_DIR);
  await rm(schemaDir, { recursive: true, force: true });
  for (const definition of definitions) {
    await writeDefinitionFile(schemaDir, definition, site ?? null);
  }
  await writeLockFile(join(dir, PLAN_LOCK_FILE), EMPTY_LOCK);
  const map = plannedMap(source, info, ids, site);
  await writeImportMap(dir, map);
  return { definitions, map };
};
