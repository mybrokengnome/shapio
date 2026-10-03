import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ImportSourceKind } from './types.js';

/**
 * `import-map.json`: written by `--plan`, then the state of `--map` runs, so a re-run continues where the last
 * one stopped. It records what was planned (definition and field IDs per source key, entries, media) and what
 * was created (asset and entry IDs per source ID, change sets). Rewritten atomically after every step.
 */
export const IMPORT_MAP_FILE = 'import-map.json';
export const IMPORT_MAP_FORMAT = 'shapio-import-map';
export const IMPORT_MAP_FORMAT_VERSION = 1;

export type PlannedDefinitionIds = {
  id: string;
  kind: string;
  apiKey: string;
  /** Field ID per source field key. */
  fields: Record<string, string>;
};

export type PlannedEntry = {
  definition: string;
  title: string;
  /** Locale codes; `null` for a model that is not localized. */
  locales: Array<string | null>;
  /** The locales that were published at the source. */
  published: Array<string | null>;
};

export type CreatedEntry = {
  entryId: string;
  /** Locales written so far (`""` for a model that is not localized). */
  locales: string[];
  /** False while references left out to break a cycle still have to be written. */
  complete: boolean;
};

export type ImportState = {
  /** The site the first `--map` run wrote to (`null`: the token's site or the primary). */
  site: string | null;
  baseUrl: string | null;
  media: Record<string, { assetId: string }>;
  entries: Record<string, CreatedEntry>;
  /** The last error per media or entry source ID; cleared when a re-run succeeds. */
  failed: Record<string, string>;
  changeSets: Array<{ id: string; title: string }>;
  /** Change set ID per `${entryId}/${locale}` already added to one. */
  changeSetItems: Record<string, string>;
};

export type ImportMap = {
  format: typeof IMPORT_MAP_FORMAT;
  formatVersion: typeof IMPORT_MAP_FORMAT_VERSION;
  source: { kind: ImportSourceKind; path: string; sha256: string };
  plannedAt: string;
  definitions: Record<string, PlannedDefinitionIds>;
  media: Record<string, { filename: string; url?: string; path?: string }>;
  entries: Record<string, PlannedEntry>;
  state: ImportState;
};

export const emptyState = (): ImportState => ({
  site: null,
  baseUrl: null,
  media: {},
  entries: {},
  failed: {},
  changeSets: [],
  changeSetItems: {},
});

export const importMapPath = (dir: string) => join(dir, IMPORT_MAP_FILE);

export const readImportMap = async (dir: string): Promise<ImportMap> => {
  const path = importMapPath(dir);
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') {
      throw new Error(`${path} does not exist: run the import with --plan ${dir} first`, { cause: error });
    }
    throw new Error(`${path} is not valid JSON: ${(error as Error).message}`, { cause: error });
  }
  const map = raw as Partial<ImportMap>;
  if (map.format !== IMPORT_MAP_FORMAT || map.formatVersion !== IMPORT_MAP_FORMAT_VERSION) {
    throw new Error(`${path} is not a version ${IMPORT_MAP_FORMAT_VERSION} import map`);
  }
  return { ...(map as ImportMap), state: { ...emptyState(), ...map.state } };
};

/** Writes the map through a temporary file, so an interrupted run never leaves half a file. */
export const writeImportMap = async (dir: string, map: ImportMap) => {
  const path = importMapPath(dir);
  await writeFile(`${path}.tmp`, `${JSON.stringify(map, null, 2)}\n`);
  await rename(`${path}.tmp`, path);
};

export const sha256File = async (path: string): Promise<string> => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
};

/** The state key of a locale: `""` stands for a model that is not localized. */
export const localeKey = (locale: string | null) => locale ?? '';
