import { createHash } from 'node:crypto';
import {
  compileLens,
  embeddedComponentIds,
  isModelDefinition,
  type DefinitionLens,
  type LensSide,
  type SchemaDefinition,
} from '@shapio/schema';
import type { Database } from '../../db/index.js';
import * as jobsRepository from '../../repositories/jobs.js';
import * as schemaActivationsRepository from '../../repositories/schemaActivations.js';
import type { ActivationAtRow, EarliestActivationRow } from '../../repositories/schemaActivations.js';
import {
  lensBudgetExceeded,
  schemaVersionAhead,
  schemaVersionForeign,
  schemaVersionInvalid,
  schemaVersionUnavailable,
} from '../errors.js';
import { buildNetworkSchema, type ActiveDefinition, type SchemaSnapshot } from '../snapshot.js';
import { readStoredRevision } from '../storedDefinition.js';
import { takeLensBuildBudget, type LensBudgetKey } from './budget.js';
import { LENS_HISTORY_BACKFILL_KEY } from './history.js';
import { createLru, createSegmentedLru, type Lru, type SegmentedLru } from './lru.js';

/**
 * Lens views (plan schema-lenses §2): a workspace's schema as it was at an older global version, built from
 * the activation history with the same constructors as the current view, and the request-level lens that
 * pairs it with the current view.
 */

/**
 * Lens views kept per workspace: keyed by the view's revisions, so many versions share one. Each workspace
 * has its own caches, so a caller cycling versions in one workspace never evicts another's; within one, the
 * caches are segmented (`createSegmentedLru`): views read again stay in the protected segment while one-off
 * versions churn among themselves in probation.
 */
export const LENS_VIEW_CACHE_SIZE = { probation: 16, protected: 32 } as const;
/** Compiled definition lenses kept per process (keys are revision IDs, unique across instances). */
export const DEFINITION_LENS_CACHE_SIZE = 256;
/** History rows at one version, per workspace. */
const HISTORY_CACHE_SIZE = { probation: 16, protected: 32 } as const;

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
  /**
   * Definitions this version's view cannot serve, by definition ID and by the route key they had at the
   * version: history that does not reach it, or history that would put one apart from its parent or a
   * component it embeds (those are left out of `view`). A route that `view` does not resolve but this does
   * answers `409 SCHEMA_VERSION_UNAVAILABLE` (after authorization), not 404. Absent: none (today's view).
   */
  unavailable?: ReadonlyMap<string, UnavailableDefinition>;
};

export type UnavailableDefinition = { definitionId: string; apiKey: string; oldestVersion: number };

type Unavailable = { apiKey: string; oldestVersion: number };

type ViewEntry = {
  view: SchemaSnapshot;
  /**
   * By definition ID: history starts after the version (placed in the view as first known, never lensed),
   * or the definition was left out of the view to keep it consistent.
   */
  unavailable: ReadonlyMap<string, Unavailable>;
  /** The same, also by the route key each had at the version: what callers look up. */
  byRoute: ReadonlyMap<string, UnavailableDefinition>;
};

/** One workspace's caches. */
type SiteCaches = {
  earliest?: Promise<EarliestActivationRow[]>;
  history: SegmentedLru<number, Promise<ActivationAtRow[]>>;
  views: SegmentedLru<string, Promise<ViewEntry>>;
};

type LensState = {
  /** Unique per set of caches: what `lensViewGeneration` reports for the views built from them. */
  generation: number;
  /** `clearLensCaches` calls this state has seen: a later call drops it. */
  cleared: number;
  /**
   * Whether the history backfill had finished when these caches started. While it runs they still cache
   * (a client must not cost a full build per request), and they are dropped the first time a request sees
   * it finished: everything they hold may predate rows it wrote or repaired.
   */
  settled: boolean;
  /** Per workspace (`siteId ?? ''`); workspaces are few, so the map is not bounded beyond them. */
  sites: Map<string, SiteCaches>;
};

let generations = 0;
let clearCount = 0;
const states = new WeakMap<Database, LensState>();
const definitionLenses = createLru<string, DefinitionLens | null>(DEFINITION_LENS_CACHE_SIZE);
const viewHashes = new WeakMap<SchemaSnapshot, string>();
const viewGenerations = new WeakMap<SchemaSnapshot, number>();

const freshState = (db: Database, settled: boolean): LensState => {
  generations += 1;
  const state: LensState = {
    generation: generations,
    cleared: clearCount,
    settled,
    sites: new Map(),
  };
  states.set(db, state);
  return state;
};

/** Drops every cached lens view and compiled lens (the history backfill finished; tests). */
export const clearLensCaches = (): void => {
  clearCount += 1;
  definitionLenses.clear();
};

/**
 * The cache generation a lens view was built under (0 for a view that is not a lens view). Caches of things
 * derived from a lens view (generated contracts) key on it, so they are dropped with it.
 */
export const lensViewGeneration = (view: SchemaSnapshot): number => viewGenerations.get(view) ?? 0;

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

/** The instance's caches; replaced once when the backfill is seen finished (one indexed read until then). */
const stateOf = async (db: Database): Promise<LensState> => {
  const state = states.get(db);
  if (!state || state.cleared !== clearCount) {
    return refreshSettled(db, freshState(db, false));
  }
  return refreshSettled(db, state);
};

/**
 * The backfill writes everything it proves in one transaction, so a read sees history either as the
 * migration left it (baseline rows: unavailable where they do not reach) or complete, never in between.
 * Caches count as final only once the job succeeded; until then (pending, running, failed, dead) they are
 * dropped the first time a request sees it succeed.
 */
const refreshSettled = async (db: Database, state: LensState): Promise<LensState> => {
  if (state.settled) {
    return state;
  }
  const job = await jobsRepository.findByIdempotencyKey(LENS_HISTORY_BACKFILL_KEY, db);
  const settled = !job || job.status === 'succeeded';
  return settled ? freshState(db, true) : state;
};

const siteCachesOf = (state: LensState, siteKey: string): SiteCaches => {
  let caches = state.sites.get(siteKey);
  if (!caches) {
    caches = {
      history: createSegmentedLru(HISTORY_CACHE_SIZE),
      views: createSegmentedLru(LENS_VIEW_CACHE_SIZE),
    };
    state.sites.set(siteKey, caches);
  }
  return caches;
};

const inView = (siteId: string | null, rowSiteId: string | null) =>
  rowSiteId === null || rowSiteId === siteId;

/** Its earliest row starts later than its first activation: what came before is unknown. */
export const historyIsIncomplete = (row: EarliestActivationRow) =>
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

/** A definition whose parent or an embedded component is not in the set: the set cannot hold it. */
const isOrphan = (definition: SchemaDefinition, ids: ReadonlySet<string>) =>
  (isModelDefinition(definition) && definition.extends !== undefined && !ids.has(definition.extends)) ||
  embeddedComponentIds(definition).some((id) => !ids.has(id));

/**
 * The definitions a view can hold together. History that places a kind apart from its parent, or a
 * definition apart from a component it embeds, is inconsistent (a wrong backfill); those definitions leave
 * the view, repeatedly until none is left without what it needs, and read as unavailable.
 */
const consistentDefinitions = (definitions: readonly ActiveDefinition[]) => {
  let kept = [...definitions];
  const removed: ActiveDefinition[] = [];
  for (;;) {
    const ids = new Set(kept.map((active) => active.definition.id));
    const orphans = kept.filter((active) => isOrphan(active.definition, ids));
    if (orphans.length === 0) {
      return { kept, removed };
    }
    removed.push(...orphans);
    kept = kept.filter((active) => !orphans.includes(active));
  }
};

/** Route keys at the version, by definition ID, from a view over every definition (before pruning). */
const routeKeysOf = (view: SchemaSnapshot): Map<string, string> =>
  new Map(
    [...view.modelsByRouteKey, ...view.interfacesByRouteKey].map(([routeKey, active]) => [
      active.definition.id,
      routeKey,
    ]),
  );

const viewOf = (current: SchemaSnapshot, version: number, definitions: readonly ActiveDefinition[]) => {
  // The network of a lens view holds this workspace's definitions only: it serves name lookups, never planning.
  const network = buildNetworkSchema(version, definitions, current.locales);
  return current.siteId === null ? network.shared() : network.forSite(current.siteId);
};

/**
 * Ancestors the set lacks, taken from today's schema (any workspace, as shared): only to name the route a
 * left-out kind had (`products/digital`), never served.
 */
const missingAncestorsOf = (
  definitions: readonly ActiveDefinition[],
  current: SchemaSnapshot,
): ActiveDefinition[] => {
  const ids = new Set(definitions.map((active) => active.definition.id));
  const extras: ActiveDefinition[] = [];
  const queue = [...definitions];
  while (queue.length > 0) {
    const { definition } = queue.pop() as ActiveDefinition;
    const parentId = isModelDefinition(definition) ? definition.extends : undefined;
    const parent =
      parentId === undefined || ids.has(parentId) ? undefined : current.network.byId.get(parentId);
    if (parent) {
      ids.add(parent.definition.id);
      const shared = { ...parent, siteId: null };
      extras.push(shared);
      queue.push(shared);
    }
  }
  return extras;
};

const buildViewEntry = async (
  current: SchemaSnapshot,
  version: number,
  { rows, unavailable }: ViewRows,
): Promise<ViewEntry> => {
  const all = await Promise.all(
    [...rows, ...unavailable.filter((row) => row.revisionId !== null)].map(toActiveDefinition),
  );
  const { kept: definitions, removed } = consistentDefinitions(all);
  const view = viewOf(current, version, definitions);
  const routeKeys = routeKeysOf(
    removed.length === 0 ? view : viewOf(current, version, [...all, ...missingAncestorsOf(all, current)]),
  );
  const apiKeys = new Map(all.map((active) => [active.definition.id, active.definition.apiKey]));
  const byId = new Map<string, Unavailable>([
    ...unavailable.map((row): [string, Unavailable] => [
      row.modelId,
      { apiKey: apiKeys.get(row.modelId) ?? row.modelId, oldestVersion: row.schemaVersion },
    ]),
    // Inconsistent history: only the current version is known to work.
    ...removed.map((active): [string, Unavailable] => [
      active.definition.id,
      { apiKey: active.definition.apiKey, oldestVersion: current.version },
    ]),
  ]);
  const byRoute = new Map<string, UnavailableDefinition>();
  for (const [definitionId, { apiKey, oldestVersion }] of byId) {
    const entry = { definitionId, apiKey, oldestVersion };
    byRoute.set(definitionId, entry);
    const routeKey = routeKeys.get(definitionId);
    if (routeKey !== undefined) {
      byRoute.set(routeKey, entry);
    }
  }
  return { view, unavailable: byId, byRoute };
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
    // Both sides read every definition either side reaches (a component only the client's version embeds is
    // still read on today's side), so the key names both sides' revision of each.
    const ids = [...new Set([...clientIds, ...closureOf(current, id)])].sort();
    const key = `${id}|${revisionsKey(current, ids)}|${revisionsKey(entry.view, ids)}`;
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
 * Whether a request naming `version` needs a lens: false at the current version, `SCHEMA_VERSION_AHEAD`
 * past it. No database work, so callers may run it before authorization and load the lens after.
 */
export const needsRequestLens = (current: SchemaSnapshot, version: number): boolean => {
  if (version > current.version) {
    throw schemaVersionAhead(version, current.version);
  }
  return version !== current.version;
};

/**
 * The lens for a request naming `version` against `current` (the workspace's view the request pinned); null
 * when it names the current version, `SCHEMA_VERSION_AHEAD` past it. Call it after the request is
 * authorized: a cache miss costs one build from `budget` (`lensBudgetKeyOf`), and an empty bucket is
 * `LENS_BUDGET_EXCEEDED`, decided before any database work, so a refused caller evicts nothing. null budget
 * (admin review, system work) is never limited.
 */
export const loadRequestLens = async (
  db: Database,
  current: SchemaSnapshot,
  version: number,
  budget: LensBudgetKey | null,
): Promise<RequestLens | null> => {
  if (!needsRequestLens(current, version)) {
    return null;
  }
  let charged = false;
  /** A miss costs one build from the caller's budget, at most once per request, before any work. */
  const chargeMiss = <T>(cached: T | undefined) => {
    if (cached !== undefined || charged || budget === null) {
      return;
    }
    if (!takeLensBuildBudget(budget)) {
      throw lensBudgetExceeded();
    }
    charged = true;
  };
  const state = await stateOf(db);
  const scope = { siteId: current.siteId };
  const caches = siteCachesOf(state, current.siteId ?? '');
  chargeMiss(caches.history.get(version));
  chargeMiss(caches.earliest);
  const earliestLoad = (caches.earliest ??= schemaActivationsRepository.findEarliest(db, scope));
  earliestLoad.catch(() => {
    if (caches.earliest === earliestLoad) {
      caches.earliest = undefined;
    }
  });
  const [rows, earliest] = await Promise.all([
    remember(caches.history, version, () => schemaActivationsRepository.findAt(version, db, scope)),
    earliestLoad,
  ]);
  const viewRows = viewRowsOf(current.siteId, version, rows, earliest);
  const hash = hashOf([
    ...viewRows.rows.map((row) => `${row.modelId}=${row.revisionId}`),
    ...viewRows.unavailable.map((row) => `${row.modelId}=?`),
  ]);
  // Locales are today's in every view (a lens does not hide locale changes).
  const viewKey = `${JSON.stringify(current.locales)}|${hash}`;
  chargeMiss(caches.views.get(viewKey));
  const entry = await remember(caches.views, viewKey, () => buildViewEntry(current, version, viewRows));
  // A cached view may come from another version with the same revisions: only the number differs.
  const view = entry.view.version === version ? entry.view : Object.freeze({ ...entry.view, version });
  viewGenerations.set(view, state.generation);
  return {
    requested: version,
    current: current.version,
    view,
    identity: hash === currentHashOf(current),
    lensFor: createLensFor(current, { ...entry, view }),
    unavailable: entry.byRoute,
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
