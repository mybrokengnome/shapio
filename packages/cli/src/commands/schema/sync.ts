import { createClient, ShapioApiError, type SchemaApplyResult } from '@shapio/client';
import { LOCK_FILE_FORMAT_VERSION, lockCoversSite, type LockFile } from '@shapio/schema';
import type { CliIo } from '../../types.js';
import { displayPath, readLocalFiles, readLockFile, type LocalFile } from './files.js';
import { formatApiError, formatItem, parentKeyOf, type ImplementedIds, type ParentIds } from './format.js';
import type { ConnectionOptions, SchemaCommandOptions } from './options.js';
import { baseForSite, filesForSite, scopesOf } from './siteTree.js';

export const EMPTY_LOCK: LockFile = {
  formatVersion: LOCK_FILE_FORMAT_VERSION,
  schemaVersion: 0,
  sites: [],
  definitions: {},
};

export type LocalState = {
  files: LocalFile[];
  lock: LockFile;
  /** API IDs by stable ID, of every definition and field in the files. */
  names: Map<string, string>;
  /** Each model's parent (`extends`) by stable ID. */
  parents: ParentIds;
  /** The interfaces each model implements itself (`implements`) by stable ID. */
  implemented: ImplementedIds;
};

/** One site's part of the local tree: what an apply for `siteKey` sends. */
export type SiteState = LocalState & { siteKey: string; sent: LocalFile[] };

type RawDefinition = {
  id?: string;
  apiKey?: string;
  extends?: string;
  implements?: unknown;
  fields?: Array<{ id?: string; apiKey?: string }>;
};

/**
 * Field and definition names by ID from every local file (all sites' folders too, and interfaces/ like the
 * other kinds' folders), for readable diffs. A type
 * that extends another stores only its own fields, and an inherited field keeps its parent's ID, so the
 * parent's file names it: the whole file set is read, never one site's part, and inherited fields resolve.
 */
export const collectNames = (files: readonly LocalFile[]): Map<string, string> => {
  const names = new Map<string, string>();
  for (const file of files) {
    const raw = file.raw as RawDefinition;
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

/**
 * Each model's parent ID (`extends`, a stable ID like a relation's target) from the local files, keyed by the
 * model's ID and by its API ID (`parentKeyOf`): a new file may have no ID yet, which the instance assigns.
 */
export const collectParents = (files: readonly LocalFile[]): Map<string, string> => {
  const parents = new Map<string, string>();
  for (const file of files) {
    const raw = file.raw as RawDefinition;
    if (typeof raw.extends !== 'string' || raw.extends === '') {
      continue;
    }
    if (raw.id) {
      parents.set(raw.id, raw.extends);
    }
    if (raw.apiKey) {
      parents.set(parentKeyOf(raw.apiKey), raw.extends);
    }
  }
  return parents;
};

/**
 * The interfaces each model declares in `implements` (stable IDs, like `extends`) from the local files, keyed
 * like `collectParents`. What a model inherits from its parent's `implements` is not listed: the header shows
 * what its own file says.
 */
export const collectImplemented = (files: readonly LocalFile[]): Map<string, readonly string[]> => {
  const implemented = new Map<string, readonly string[]>();
  for (const file of files) {
    const raw = file.raw as RawDefinition;
    const ids = Array.isArray(raw.implements)
      ? raw.implements.filter((id): id is string => typeof id === 'string' && id !== '')
      : [];
    if (ids.length === 0) {
      continue;
    }
    if (raw.id) {
      implemented.set(raw.id, ids);
    }
    if (raw.apiKey) {
      implemented.set(parentKeyOf(raw.apiKey), ids);
    }
  }
  return implemented;
};

export const readLocalState = async (options: SchemaCommandOptions): Promise<LocalState> => {
  const files = await readLocalFiles(options.dir);
  return {
    files,
    lock: (await readLockFile(options.lockPath)) ?? EMPTY_LOCK,
    names: collectNames(files),
    parents: collectParents(files),
    implemented: collectImplemented(files),
  };
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
          state.parents,
          state.implemented,
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
      io.stdout(`${formatItem(item, state.names, state.parents, state.implemented)}\n`);
    }
  }
};
