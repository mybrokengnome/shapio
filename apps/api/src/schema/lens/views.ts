import { createHash } from 'node:crypto';
import { compileLens, embeddedComponentIds, type DefinitionLens, type LensSide } from '@shapio/schema';
import type { Database } from '../../db/index.js';
import * as jobsRepository from '../../repositories/jobs.js';
import * as schemaActivationsRepository from '../../repositories/schemaActivations.js';
import type { ActivationAtRow, EarliestActivationRow } from '../../repositories/schemaActivations.js';
import {
  schemaVersionAhead,
  schemaVersionForeign,
  schemaVersionInvalid,
  schemaVersionUnavailable,
} from '../errors.js';
import { buildNetworkSchema, type ActiveDefinition, type SchemaSnapshot } from '../snapshot.js';
import { readStoredRevision } from '../storedDefinition.js';
import { LENS_HISTORY_BACKFILL_KEY } from './history.js';
import { createLru, type Lru } from './lru.js';

/**
 * Lens views (plan schema-lenses §2): a workspace's schema as it was at an older global version, built from
 * the activation history with the same constructors as the current view, and the request-level lens that
 * pairs it with the current view.
 */

/** Lens views kept per instance: keyed by workspace and the view's revisions, so many versions share one. */
export const LENS_VIEW_CACHE_SIZE = 32;
/** Compiled definition lenses kept per process (keys are revision IDs, unique across instances). */
export const DEFINITION_LENS_CACHE_SIZE = 256;
/** History rows at one version, kept once history can no longer change below it. */
const HISTORY_CACHE_SIZE = 32;

export type RequestLens = {
  requested: number;
  current: number;
  /** The workspace's view at the requested version; `version === requested`. */
  view: SchemaSnapshot;
  /** No revision in this workspace's view changed between the requested version and the current one. */
  identity: boolean;
  /**
   * The lens from today's definition to the requested version's, cached per the revisions both sides hold
   * of the definition, its ancestors and every component it embeds. Throws `SCHEMA_VERSION_UNAVAILABLE` when
   * the history of one of them does not reach the requested version. null: the client's version does not
   * know the definition (created since), so nothing of it may be shown.
   */
  lensFor: (modelOrComponentId: string) => DefinitionLens | null;
};

type Unavailable = { apiKey: string; oldestVersion: number };

type ViewEntry = {
  view: SchemaSnapshot;
  /** Definitions whose history starts after the version: placed in the view as first known, never lensed. */
  unavailable: ReadonlyMap<string, Unavailable>;
};

type LensState = {
  /** `clearLensCaches` calls seen: an older count drops everything below. */
  generation: number;
  /** Set once the history backfill is no longer pending: rows below the current version are then final. */
  settled: boolean;
  earliest?: Promise<EarliestActivationRow[]>;
  history: Lru<number, Promise<ActivationAtRow[]>>;
  views: Lru<string, Promise<ViewEntry>>;
};

let generation = 0;
const states = new WeakMap<Database, LensState>();
const definitionLenses = createLru<string, DefinitionLens | null>(DEFINITION_LENS_CACHE_SIZE);
const viewHashes = new WeakMap<SchemaSnapshot, string>();

const stateOf = (db: Database): LensState => {
  let state = states.get(db);
  if (!state || state.generation !== generation) {
    state = {
      generation,
      settled: false,
      history: createLru(HISTORY_CACHE_SIZE),
      views: createLru(LENS_VIEW_CACHE_SIZE),
    };
    states.set(db, state);
  }
  return state;
};

/** Drops every cached lens view and compiled lens (the history backfill finished; tests). */
export const clearLensCaches = (): void => {
  generation += 1;
  definitionLenses.clear();
};

/** A cached promise that rejected is forgotten, so the next request tries again. */
const remember = <K, V>(cache: Lru<K, Promise<V>>, key: K, load: () => Promise<V>): Promise<V> => {
  let value = cache.get(key);
  if (!value) {
    value = load();
    cache.set(key, value);
    value.catch(() => cache.delete(key));
  }
  return value;
};

const isSettled = async (db: Database, state: LensState): Promise<boolean> => {
  if (!state.settled) {
    const job = await jobsRepository.findByIdempotencyKey(LENS_HISTORY_BACKFILL_KEY, db);
    state.settled = !job || job.status === 'succeeded' || job.status === 'dead';
  }
  return state.settled;
};

/** Rows at the version and every model's earliest row; cached only once history is final. */
const historyOf = async (db: Database, state: LensState, version: number) => {
  if (!(await isSettled(db, state))) {
    return {
      cacheable: false,
      rows: await schemaActivationsRepository.findAt(version, db),
      earliest: await schemaActivationsRepository.findEarliest(db),
    };
  }
  const rows = remember(state.history, version, () => schemaActivationsRepository.findAt(version, db));
  const earliest = (state.earliest ??= schemaActivationsRepository.findEarliest(db));
  earliest.catch(() => {
    if (state.earliest === earliest) {
      state.earliest = undefined;
    }
  });
  return { cacheable: true, rows: await rows, earliest: await earliest };
};

const inView = (siteId: string | null, rowSiteId: string | null) =>
  rowSiteId === null || rowSiteId === siteId;

/** Its earliest row starts later than its first activation: what came before is unknown. */
const historyIsIncomplete = (row: EarliestActivationRow) =>
  row.backfilled && (row.revisionId === null || row.parentRevisionId !== null);

const toActiveDefinition = async (
  row: Pick<
    ActivationAtRow,
    'modelId' | 'siteId' | 'revisionId' | 'version' | 'hash' | 'definition' | 'activatedAt'
  >,
): Promise<ActiveDefinition> => ({
  ...(await readStoredRevision(row.definition, row.hash ?? '')),
  siteId: row.siteId,
  version: row.version ?? 0,
  revisionId: row.revisionId ?? '',
  activatedAt: row.activatedAt,
});

const hashOf = (entries: readonly string[]) =>
  createHash('sha256')
    .update([...entries].sort().join('\n'))
    .digest('hex');

const currentHashOf = (current: SchemaSnapshot): string => {
  let hash = viewHashes.get(current);
  if (hash === undefined) {
    hash = hashOf(current.definitions.map((active) => `${active.definition.id}=${active.revisionId}`));
    viewHashes.set(current, hash);
  }
  return hash;
};

type ViewRows = {
  rows: ActivationAtRow[];
  unavailable: EarliestActivationRow[];
};

/** The workspace's rows at the version: active definitions, plus those whose history does not reach it. */
const viewRowsOf = (
  siteId: string | null,
  version: number,
  rows: readonly ActivationAtRow[],
  earliest: readonly EarliestActivationRow[],
): ViewRows => {
  const present = new Set(rows.map((row) => row.modelId));
  return {
    rows: rows.filter((row) => row.revisionId !== null && inView(siteId, row.siteId)),
    unavailable: earliest.filter(
      (row) =>
        row.schemaVersion > version &&
        !present.has(row.modelId) &&
        historyIsIncomplete(row) &&
        inView(siteId, row.siteId),
    ),
  };
};

const buildViewEntry = async (
  current: SchemaSnapshot,
  version: number,
  { rows, unavailable }: ViewRows,
): Promise<ViewEntry> => {
  const definitions = await Promise.all(
    [...rows, ...unavailable.filter((row) => row.revisionId !== null)].map(toActiveDefinition),
  );
  // The network of a lens view holds this workspace's definitions only: it serves name lookups, never planning.
  const network = buildNetworkSchema(version, definitions, current.locales);
  const view = current.siteId === null ? network.shared() : network.forSite(current.siteId);
  const apiKeys = new Map(definitions.map((active) => [active.definition.id, active.definition.apiKey]));
  return {
    view,
    unavailable: new Map(
      unavailable.map((row) => [
        row.modelId,
        { apiKey: apiKeys.get(row.modelId) ?? row.modelId, oldestVersion: row.schemaVersion },
      ]),
    ),
  };
};

const sideOf = (view: SchemaSnapshot): LensSide => ({
  get: (id) => view.byId.get(id)?.definition,
  resolve: view.resolve,
});

/** The definition, its ancestors and interfaces, and every component it embeds, transitively. */
const closureOf = (view: SchemaSnapshot, id: string): string[] => {
  const seen = new Set<string>();
  const queue = [id];
  while (queue.length > 0) {
    const next = queue.pop() as string;
    if (seen.has(next)) {
      continue;
    }
    seen.add(next);
    const definition = view.byId.get(next)?.definition;
    if (definition) {
      queue.push(...view.ancestors(next), ...view.interfacesOf(next), ...embeddedComponentIds(definition));
    }
  }
  return [...seen].sort();
};

const revisionsKey = (view: SchemaSnapshot, ids: readonly string[]) =>
  ids.map((id) => `${id}=${view.byId.get(id)?.revisionId ?? '-'}`).join(',');

const createLensFor = (current: SchemaSnapshot, entry: ViewEntry) => {
  const stored = sideOf(current);
  const client = sideOf(entry.view);
  const memo = new Map<string, DefinitionLens | null>();
  return (id: string): DefinitionLens | null => {
    if (memo.has(id)) {
      return memo.get(id) ?? null;
    }
    const clientIds = closureOf(entry.view, id);
    for (const clientId of clientIds) {
      const missing = entry.unavailable.get(clientId);
      if (missing) {
        throw schemaVersionUnavailable(missing.apiKey, missing.oldestVersion);
      }
    }
    const key = `${id}|${revisionsKey(current, closureOf(current, id))}|${revisionsKey(entry.view, clientIds)}`;
    let lens = definitionLenses.get(key);
    if (lens === undefined) {
      lens = compileLens(stored, client, id);
      definitionLenses.set(key, lens);
    }
    memo.set(id, lens);
    return lens;
  };
};

/**
 * The lens for a request naming `version` against `current` (the workspace's view the request pinned); null
 * when it names the current version. `SCHEMA_VERSION_AHEAD` when it names a version this instance has not
 * reached.
 */
export const loadRequestLens = async (
  db: Database,
  current: SchemaSnapshot,
  version: number,
): Promise<RequestLens | null> => {
  if (version === current.version) {
    return null;
  }
  if (version > current.version) {
    throw schemaVersionAhead(version, current.version);
  }
  const state = stateOf(db);
  const { cacheable, rows, earliest } = await historyOf(db, state, version);
  const viewRows = viewRowsOf(current.siteId, version, rows, earliest);
  const hash = hashOf([
    ...viewRows.rows.map((row) => `${row.modelId}=${row.revisionId}`),
    ...viewRows.unavailable.map((row) => `${row.modelId}=?`),
  ]);
  // Locales are today's in every view (a lens does not hide locale changes).
  const locales = JSON.stringify(current.locales);
  const build = () => buildViewEntry(current, version, viewRows);
  const built = cacheable
    ? remember(state.views, `${current.siteId ?? ''}|${locales}|${hash}`, build)
    : build();
  const entry = await built;
  // A cached view may come from another version with the same revisions: only the number differs.
  const view = entry.view.version === version ? entry.view : Object.freeze({ ...entry.view, version });
  return {
    requested: version,
    current: current.version,
    view,
    identity: hash === currentHashOf(current),
    lensFor: createLensFor(current, { ...entry, view }),
  };
};

const TOKEN_PATTERN = /^([0-9A-Za-z-]+):(\d{1,10})$/;
const MAX_VERSION = 2_147_483_647;

/**
 * Reads `<schemaId>:<version>` (what `shapio types generate` writes as `SCHEMA_VERSION`). A malformed value is
 * `SCHEMA_VERSION_INVALID`; another instance's schema ID is `SCHEMA_VERSION_FOREIGN`, because version numbers
 * only mean something on the instance that issued them.
 */
export const parseSchemaVersionToken = (token: string, schemaId: string): number => {
  const match = TOKEN_PATTERN.exec(token.trim());
  const version = match ? Number(match[2]) : Number.NaN;
  if (!match || !Number.isSafeInteger(version) || version > MAX_VERSION) {
    throw schemaVersionInvalid(token);
  }
  if ((match[1] as string).toLowerCase() !== schemaId.toLowerCase()) {
    throw schemaVersionForeign();
  }
  return version;
};
