import type { Dirent } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import {
  hashDefinition,
  parseDefinition,
  parseLockFile,
  SCHEMA_KIND_DIRECTORIES,
  schemaFilePath,
  scopeDirectory,
  SITES_DIRECTORY,
  serializeDefinition,
  serializeLockFile,
  type LockFile,
  type SchemaDefinition,
} from '@shapio/schema';

/**
 * Schema files: one canonical JSON file per definition. Shared ones in `models/` and `components/`, a site's
 * own in `sites/<siteKey>/models/` and `sites/<siteKey>/components/` (the layout of `@shapio/schema`).
 */
export type LocalFile = {
  path: string;
  raw: unknown;
  /** The scope its folder names: a site key, or null for the shared folders. */
  site: string | null;
  id?: string;
  hash?: string;
};

/** The file of a definition in a scope (`site`: its site key, null when shared). */
export const definitionPath = (
  dir: string,
  definition: Pick<SchemaDefinition, 'kind' | 'apiKey'>,
  site: string | null,
) => join(dir, ...schemaFilePath(definition, site).split('/'));

const isMissing = (error: unknown) => (error as { code?: string }).code === 'ENOENT';

const listNames = async (path: string, filter: (entry: Dirent) => boolean) => {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter(filter)
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (isMissing(error)) {
      return [];
    }
    throw error;
  }
};

const readLocalFile = async (path: string, site: string | null): Promise<LocalFile> => {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
  const parsed = parseDefinition(raw);
  return parsed.ok
    ? { path, raw, site, id: parsed.definition.id, hash: await hashDefinition(parsed.definition) }
    : { path, raw, site };
};

/** The files of one scope's folder (`models/` and `components/` under it). */
const readScopeFiles = async (dir: string, site: string | null): Promise<LocalFile[]> => {
  const base = join(dir, ...scopeDirectory(site).split('/').filter(Boolean));
  const files: LocalFile[] = [];
  for (const kindDir of SCHEMA_KIND_DIRECTORIES) {
    for (const name of await listNames(
      join(base, kindDir),
      (entry) => entry.isFile() && entry.name.endsWith('.json'),
    )) {
      files.push(await readLocalFile(join(base, kindDir, name), site));
    }
  }
  return files;
};

/** Every schema file under `dir`: the shared folders first, then each site folder by key. */
export const readLocalFiles = async (dir: string): Promise<LocalFile[]> => {
  const files = await readScopeFiles(dir, null);
  for (const siteKey of await listNames(
    join(dir, SITES_DIRECTORY),
    (entry) => entry.isDirectory() && !entry.name.startsWith('.'),
  )) {
    files.push(...(await readScopeFiles(dir, siteKey)));
  }
  return files;
};

export const readLockFile = async (path: string): Promise<LockFile | undefined> => {
  try {
    return parseLockFile(await readFile(path, 'utf8'));
  } catch (error) {
    if (isMissing(error)) {
      return undefined;
    }
    throw error;
  }
};

export const writeLockFile = async (path: string, lock: LockFile) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, serializeLockFile(lock));
};

export const writeDefinitionFile = async (dir: string, definition: SchemaDefinition, site: string | null) => {
  const path = definitionPath(dir, definition, site);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, serializeDefinition(definition));
  return path;
};

export const removeFile = (path: string) => rm(path, { force: true });

export const displayPath = (path: string) => relative(process.cwd(), path) || path;
