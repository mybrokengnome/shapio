import { createClient, ShapioApiError } from '@shapio/client';
import { LOCK_FILE_FORMAT_VERSION, type LockFile } from '@shapio/schema';
import type { CliIo } from '../../types.js';
import { schemaApi, type ApplyResponse } from './api.js';
import { readLocalFiles, readLockFile, type LocalFile } from './files.js';
import { formatApiError, formatItem } from './format.js';
import type { SchemaCommandOptions } from './options.js';

export const EMPTY_LOCK: LockFile = {
  formatVersion: LOCK_FILE_FORMAT_VERSION,
  schemaVersion: 0,
  definitions: {},
};

export type LocalState = { files: LocalFile[]; lock: LockFile; names: Map<string, string> };

/** Field and definition names by ID from the local files, for readable diffs. */
const collectNames = (files: readonly LocalFile[]) => {
  const names = new Map<string, string>();
  for (const file of files) {
    const raw = file.raw as {
      id?: string;
      apiKey?: string;
      fields?: Array<{ id?: string; apiKey?: string }>;
    };
    if (raw.id && raw.apiKey) {
      names.set(raw.id, raw.apiKey);
    }
    for (const field of raw.fields ?? []) {
      if (field.id && field.apiKey) {
        names.set(field.id, field.apiKey);
      }
    }
  }
  return names;
};

export const readLocalState = async (options: SchemaCommandOptions): Promise<LocalState> => {
  const files = await readLocalFiles(options.dir);
  return { files, lock: (await readLockFile(options.lockPath)) ?? EMPTY_LOCK, names: collectNames(files) };
};

export const apiFor = (options: SchemaCommandOptions) =>
  schemaApi(createClient({ baseUrl: options.baseUrl, token: options.token }));

/** Sends the local files with their lock-file bases; the server decides per definition (three-way). */
export const sendApply = async (
  options: SchemaCommandOptions,
  state: LocalState,
  dryRun: boolean,
  io: CliIo,
): Promise<ApplyResponse | undefined> => {
  try {
    return await apiFor(options).apply({
      definitions: state.files.map((file) => file.raw),
      base: state.lock,
      prune: options.prune,
      dryRun,
      acknowledgeBreaking: options.allowBreaking,
      acknowledgeDestructive: options.allowDestructive,
    });
  } catch (error) {
    if (error instanceof ShapioApiError) {
      io.stderr(
        formatApiError(
          error,
          state.files.map((file) => file.path),
          state.names,
        ),
      );
      return undefined;
    }
    throw error;
  }
};

export const printResults = (response: ApplyResponse, state: LocalState, io: CliIo, verbose: boolean) => {
  for (const item of response.results) {
    if (verbose || item.decision.action !== 'skip' || item.decision.reason !== 'unchangedLocally') {
      io.stdout(`${formatItem(item, state.names)}\n`);
    }
  }
};
