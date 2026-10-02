import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import {
  hashDefinition,
  parseDefinition,
  parseLockFile,
  serializeDefinition,
  serializeLockFile,
  type LockFile,
  type SchemaDefinition,
} from '@shapio/schema';

/** Schema files: one canonical JSON file per definition, `models/<apiKey>.json` or `components/<apiKey>.json`. */
const KIND_DIRECTORIES = ['models', 'components'] as const;

export type LocalFile = { path: string; raw: unknown; id?: string; hash?: string };

export const definitionPath = (dir: string, definition: Pick<SchemaDefinition, 'kind' | 'apiKey'>) =>
  join(dir, definition.kind === 'component' ? 'components' : 'models', `${definition.apiKey}.json`);

const isMissing = (error: unknown) => (error as { code?: string }).code === 'ENOENT';

/** Every schema file under `dir`, with its ID and canonical hash when it parses. */
export const readLocalFiles = async (dir: string): Promise<LocalFile[]> => {
  const files: LocalFile[] = [];
  for (const kindDir of KIND_DIRECTORIES) {
    let names: string[];
    try {
      names = (await readdir(join(dir, kindDir))).filter((name) => name.endsWith('.json')).sort();
    } catch (error) {
      if (isMissing(error)) {
        continue;
      }
      throw error;
    }
    for (const name of names) {
      const path = join(dir, kindDir, name);
      let raw: unknown;
      try {
        raw = JSON.parse(await readFile(path, 'utf8'));
      } catch (error) {
        throw new Error(
          `${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
      const parsed = parseDefinition(raw);
      files.push(
        parsed.ok
          ? { path, raw, id: parsed.definition.id, hash: await hashDefinition(parsed.definition) }
          : { path, raw },
      );
    }
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

export const writeDefinitionFile = async (dir: string, definition: SchemaDefinition) => {
  const path = definitionPath(dir, definition);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, serializeDefinition(definition));
  return path;
};

export const removeFile = (path: string) => rm(path, { force: true });

export const displayPath = (path: string) => relative(process.cwd(), path) || path;
