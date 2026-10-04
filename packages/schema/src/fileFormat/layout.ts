import type { SchemaDefinition } from '../types/definitions.js';

/**
 * Where schema files live in a repository (plan site-schema): shared definitions in `models/` and
 * `components/`, a site's own in `sites/<siteKey>/models/` and `sites/<siteKey>/components/`. Paths are
 * relative to the schema directory and always use `/` (git paths); callers join them for their file system.
 */
export const SCHEMA_KIND_DIRECTORIES = ['models', 'components'] as const;
export type SchemaKindDirectory = (typeof SCHEMA_KIND_DIRECTORIES)[number];

/** The folder that holds one directory per site key. */
export const SITES_DIRECTORY = 'sites';

const kindDirectoryOf = (definition: Pick<SchemaDefinition, 'kind'>): SchemaKindDirectory =>
  definition.kind === 'component' ? 'components' : 'models';

/** The directory of a scope's files: `''` (shared) or `sites/<siteKey>`. */
export const scopeDirectory = (siteKey: string | null): string =>
  siteKey === null ? '' : `${SITES_DIRECTORY}/${siteKey}`;

/** A definition's file path: `models/post.json`, or `sites/blog/models/post.json` for site `blog`. */
export const schemaFilePath = (
  definition: Pick<SchemaDefinition, 'kind' | 'apiKey'>,
  siteKey: string | null,
): string => {
  const file = `${kindDirectoryOf(definition)}/${definition.apiKey}.json`;
  return siteKey === null ? file : `${scopeDirectory(siteKey)}/${file}`;
};

/**
 * The scope a schema file path is in: `{ site: null }` for `models/x.json` or `components/x.json`,
 * `{ site: key }` under `sites/<key>/`, undefined for anything else (not a schema file).
 */
export const scopeOfSchemaFilePath = (path: string): { site: string | null } | undefined => {
  const parts = path.split('/').filter((part) => part.length > 0);
  const isFile = (kind: string | undefined, name: string | undefined) =>
    (SCHEMA_KIND_DIRECTORIES as readonly string[]).includes(kind ?? '') && (name ?? '').endsWith('.json');
  if (parts.length === 2 && isFile(parts[0], parts[1])) {
    return { site: null };
  }
  if (parts.length === 4 && parts[0] === SITES_DIRECTORY && parts[1] && isFile(parts[2], parts[3])) {
    return { site: parts[1] };
  }
  return undefined;
};
