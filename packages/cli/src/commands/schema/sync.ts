import { createClient, ShapioApiError, type SchemaApplyResult } from '@shapio/client';
import { LOCK_FILE_FORMAT_VERSION, lockCoversSite, type LockFile } from '@shapio/schema';
import type { CliIo } from '../../types.js';
import { displayPath, readLocalFiles, readLockFile, type LocalFile } from './files.js';
import { formatApiError, formatItem } from './format.js';
import type { ConnectionOptions, SchemaCommandOptions } from './options.js';
import { baseForSite, filesForSite, scopesOf } from './siteTree.js';

export const EMPTY_LOCK: LockFile = {
  formatVersion: LOCK_FILE_FORMAT_VERSION,
  schemaVersion: 0,
  sites: [],
  definitions: {},
};

export type LocalState = { files: LocalFile[]; lock: LockFile; names: Map<string, string> };

/** One site's part of the local tree: what an apply for `siteKey` sends. */
export type SiteState = LocalState & { siteKey: string; sent: LocalFile[] };

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

/** The admin client for the command's site (`--site`, else the token's site, else the primary). */
export const clientFor = (options: ConnectionOptions) =>
  createClient({
    baseUrl: options.baseUrl,
    token: options.token,
    ...(options.site ? { site: options.site } : {}),
  });

/** The schema sync endpoints (`export`, `apply`, `change`) of @shapio/client. */
export const apiFor = (options: ConnectionOptions) => clientFor(options).admin.schema;

/** The key of the site the command works on, as the instance resolved it (an unnamed site is the default). */
export const resolveSiteKey = async (options: ConnectionOptions): Promise<string> => {
  if (options.site) {
    return options.site;
  }
  const { site } = await apiFor(options).export({ scope: 'network' });
  if (!site) {
    throw new Error('The instance did not say which site this token works on; pass --site <key>');
  }
  return site.key;
};

/**
 * The local tree narrowed to one site (shared files and `sites/<key>/`), or undefined (after explaining)
 * when the tree was pulled for other sites only.
 */
export const readSiteState = async (
  options: SchemaCommandOptions,
  io: CliIo,
): Promise<SiteState | undefined> => {
  const siteKey = await resolveSiteKey(options);
  const state = await readLocalState(options);
  if (!lockCoversSite(state.lock, siteKey)) {
    io.stderr(
      `${displayPath(options.lockPath)} covers the site(s) ${(state.lock.sites ?? []).join(', ')}, not "${siteKey}".\n` +
        `Apply it with --site <one of those>, or pull "${siteKey}" into this tree first: shapio schema pull --site ${siteKey}\n`,
    );
    return undefined;
  }
  return { ...state, siteKey, sent: filesForSite(state.files, siteKey) };
};

/** Sends the site's files with their lock-file bases; the server decides per definition (three-way). */
export const sendApply = async (
  options: SchemaCommandOptions,
  state: SiteState,
  dryRun: boolean,
  io: CliIo,
): Promise<SchemaApplyResult | undefined> => {
  try {
    return await apiFor(options).apply({
      definitions: state.sent.map((file) => file.raw),
      scopes: scopesOf(state.sent),
      base: baseForSite(state.lock, state.siteKey),
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
          state.sent.map((file) => displayPath(file.path)),
          state.names,
        ),
      );
      return undefined;
    }
    throw error;
  }
};

export const printResults = (response: SchemaApplyResult, state: LocalState, io: CliIo, verbose: boolean) => {
  for (const item of response.results) {
    if (verbose || item.decision.action !== 'skip' || item.decision.reason !== 'unchangedLocally') {
      io.stdout(`${formatItem(item, state.names)}\n`);
    }
  }
};
