import type { FastifyBaseLogger } from 'fastify';
import {
  GRAPHQL_LENS_SCHEMA_SPACES_MAX,
  GRAPHQL_LENS_SCHEMAS_PROBATION,
  GRAPHQL_LENS_SCHEMAS_PROTECTED,
  GRAPHQL_SCHEMA_VARIANTS_MAX,
  GRAPHQL_SITE_SCHEMA_IDLE_MS,
} from '../../../constants/graphql.js';
import { lensBudgetExceeded } from '../../errors.js';
import { createSegmentedLru, type LruSegment, type SegmentedLru } from '../../lens/lru.js';
import type { NetworkSchema, SchemaSnapshot } from '../../snapshot.js';
import { lensSchemaKey } from './lensSchemaKey.js';
import { buildGraphqlSchema, type BuildOptions, type BuiltSchema } from './schemaBuilder.js';
import { FULL_VISIBILITY, type SchemaVisibility } from './visibility.js';

/**
 * The GraphQL schemas of the sites' views (ADR 0006), one per (site, visibility): admin callers share a site's
 * full schema, and delivery callers with the same masks share one masked schema (visibility.ts), so a schema
 * never names what its caller cannot read. Each request asks for its pinned view: a schema is built on its
 * first request, one build per (site, visibility, version) however many requests wait for it, and replaces
 * the older one once built (a failed build keeps the older one; the next request retries). A schema never
 * moves backwards: a request pinned to an older version than the cached schema is served the cached one.
 * Schemas no request has used for GRAPHQL_SITE_SCHEMA_IDLE_MS are dropped, and at most `maxEntries` are kept
 * (least recently used dropped first), so memory follows the sites and callers in use.
 */
export type GraphqlSchemaCache = {
  get: (view: SchemaSnapshot, visibility?: SchemaVisibility) => Promise<BuiltSchema>;
  /**
   * A new schema version is known (LISTEN/NOTIFY): rebuilds, in the background and one at a time, the full
   * schemas already held. Masked schemas depend on their callers' policies at the new version, so each is
   * rebuilt by its next request; sites never asked for are left for their first request.
   */
  refresh: (network: NetworkSchema) => void;
  /** The cached schema of a site and visibility key (default: the full schema), if any (tests and diagnostics). */
  peek: (siteId: string | null, visibilityKey?: string) => BuiltSchema | undefined;
  /** Every schema held: its site, visibility key and built version (tests and diagnostics). */
  list: () => Array<{ siteId: string | null; visibility: string; version: number | null }>;
  /**
   * The schema of a client's version of a workspace (plan schema-lenses; `view` is `RequestLens.view`,
   * `visibility` from `lensVisibility`), built on first use and kept by exact match on what shapes it for this
   * visibility (`lensSchemaKey`): versions that look the same to the caller share one schema. Each
   * (workspace, visibility) has its own segmented cache, so walking versions churns only that cache's
   * probation, never a version clients keep reading, another workspace's, or a current-version schema.
   */
  getLens: (
    view: SchemaSnapshot,
    visibility: SchemaVisibility,
    options?: LensBuildOptions,
  ) => Promise<BuiltSchema>;
  /** The lens schemas held, per cache least recently used first within each segment (tests). */
  listLens: () => Array<{ siteId: string | null; visibility: string; view: string; segment: LruSegment }>;
  /** Stops background rebuilds (app shutdown). */
  close: () => void;
};

type Entry = {
  siteId: string | null;
  visibility: SchemaVisibility;
  built?: BuiltSchema;
  pending?: { version: number; promise: Promise<BuiltSchema> };
  lastSeen: number;
};

type SchemaCacheOptions = {
  log: FastifyBaseLogger;
  now?: () => number;
  idleMs?: number;
  maxEntries?: number;
  /** Per (workspace, visibility) lens cache: entries on probation and protected. */
  lensSegments?: { probation: number; protected: number };
  /** (workspace, visibility) lens caches kept. */
  maxLensSpaces?: number;
  build?: (view: SchemaSnapshot, visibility: SchemaVisibility, options?: BuildOptions) => BuiltSchema;
};

export type LensBuildOptions = {
  /**
   * Asked once before a cache miss builds (never on a hit): false refuses the build with 429
   * `LENS_BUDGET_EXCEEDED`, so a caller cycling versions cannot force a schema build per request (the
   * per-principal lens build budget, `schema/lens/budget.ts`).
   */
  admit?: () => boolean;
};

type LensEntry = { schema: Promise<BuiltSchema> };

type LensSpace = { siteId: string | null; visibility: string; schemas: SegmentedLru<string, LensEntry> };

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

const entryKey = (siteId: string | null, visibilityKey: string) => `${siteId ?? ''}\u0000${visibilityKey}`;

export const createGraphqlSchemaCache = ({
  log,
  now = Date.now,
  idleMs = GRAPHQL_SITE_SCHEMA_IDLE_MS,
  maxEntries = GRAPHQL_SCHEMA_VARIANTS_MAX,
  lensSegments = { probation: GRAPHQL_LENS_SCHEMAS_PROBATION, protected: GRAPHQL_LENS_SCHEMAS_PROTECTED },
  maxLensSpaces = GRAPHQL_LENS_SCHEMA_SPACES_MAX,
  build = buildGraphqlSchema,
}: SchemaCacheOptions): GraphqlSchemaCache => {
  // Map order is use order (re-inserted on every request), so the first entries are the least recently used.
  const entries = new Map<string, Entry>();
  // Lens caches by (workspace, visibility); `spaceUse` bounds and orders them (a segmented LRU of its own),
  // `spaces` finds one without counting a use.
  const spaces = new Map<string, LensSpace>();
  const spaceUse = createSegmentedLru<string, true>({
    probation: Math.ceil(maxLensSpaces / 2),
    protected: Math.floor(maxLensSpaces / 2),
  });
  let lastSweep = now();
  let closed = false;

  const sweep = (time: number) => {
    if (time - lastSweep < idleMs) {
      return;
    }
    lastSweep = time;
    for (const [key, entry] of entries) {
      if (!entry.pending && time - entry.lastSeen >= idleMs) {
        entries.delete(key);
      }
    }
  };

  /** Drops the least recently used entries beyond `maxEntries`; one being built stays until it settles. */
  const evict = () => {
    for (const [key, entry] of entries) {
      if (entries.size <= maxEntries) {
        return;
      }
      if (!entry.pending) {
        entries.delete(key);
      }
    }
  };

  const startBuild = (entry: Entry, view: SchemaSnapshot): Promise<BuiltSchema> => {
    const promise: Promise<BuiltSchema> = Promise.resolve().then(() => {
      try {
        const started = performance.now();
        const built = build(view, entry.visibility);
        if (!entry.built || built.version > entry.built.version) {
          entry.built = built;
          log.info(
            {
              siteId: view.siteId,
              visibility: entry.visibility.key,
              schemaVersion: built.version,
              durationMs: Math.round(performance.now() - started),
            },
            'GraphQL schema built',
          );
        }
        return entry.built;
      } finally {
        if (entry.pending?.promise === promise) {
          entry.pending = undefined;
        }
      }
    });
    entry.pending = { version: view.version, promise };
    return promise;
  };

  const ensure = (
    view: SchemaSnapshot,
    visibility: SchemaVisibility,
    touch: boolean,
  ): Promise<BuiltSchema> => {
    const time = now();
    sweep(time);
    const key = entryKey(view.siteId, visibility.key);
    let entry = entries.get(key);
    if (!entry) {
      entry = { siteId: view.siteId, visibility, lastSeen: time };
      entries.set(key, entry);
      evict();
    } else if (touch) {
      entries.delete(key);
      entries.set(key, entry);
    }
    if (touch) {
      entry.lastSeen = time;
    }
    if (entry.built && entry.built.version >= view.version) {
      return Promise.resolve(entry.built);
    }
    if (entry.pending && entry.pending.version >= view.version) {
      return entry.pending.promise;
    }
    return startBuild(entry, view);
  };

  const refresh = (network: NetworkSchema) => {
    const cached = [...entries.values()]
      .filter((entry) => entry.built && entry.visibility.key === FULL_VISIBILITY.key)
      .map((entry) => entry.siteId);
    void (async () => {
      for (const siteId of cached) {
        // One build per turn of the event loop, so N sites never block it in one go.
        await yieldToEventLoop();
        if (closed || !entries.has(entryKey(siteId, FULL_VISIBILITY.key))) {
          continue;
        }
        const view = siteId === null ? network.shared() : network.forSite(siteId);
        await ensure(view, FULL_VISIBILITY, false).catch((error: unknown) => {
          log.warn(
            { err: error, siteId, schemaVersion: network.version },
            'GraphQL rebuild failed; the next request retries',
          );
        });
      }
    })();
  };

  /** The lens cache of a workspace and visibility, created (and the oldest caches past the bound dropped). */
  const lensSpaceFor = (spaceKey: string, siteId: string | null, visibility: string): LensSpace => {
    let space = spaces.get(spaceKey);
    if (space) {
      spaceUse.get(spaceKey);
      return space;
    }
    space = { siteId, visibility, schemas: createSegmentedLru(lensSegments) };
    spaces.set(spaceKey, space);
    spaceUse.set(spaceKey, true);
    for (const key of spaces.keys()) {
      if (!spaceUse.has(key)) {
        spaces.delete(key);
      }
    }
    return space;
  };

  const getLens = (
    view: SchemaSnapshot,
    visibility: SchemaVisibility,
    { admit }: LensBuildOptions = {},
  ): Promise<BuiltSchema> => {
    const spaceKey = entryKey(view.siteId, visibility.key);
    const key = lensSchemaKey(view, visibility);
    const cached = spaces.get(spaceKey);
    if (cached?.schemas.has(key)) {
      // A hit costs no budget; it counts a use of the cache and of the schema (read again: protected).
      spaceUse.get(spaceKey);
      return (cached.schemas.get(key) as LensEntry).schema;
    }
    // Refused before any cache is touched: an exhausted caller evicts nothing.
    if (admit && !admit()) {
      return Promise.reject(lensBudgetExceeded());
    }
    const space = lensSpaceFor(spaceKey, view.siteId, visibility.key);
    const schema = Promise.resolve().then(() => {
      const started = performance.now();
      const built = build(view, visibility, { lens: true });
      log.info(
        {
          siteId: view.siteId,
          visibility: visibility.key,
          schemaVersion: view.version,
          durationMs: Math.round(performance.now() - started),
        },
        'GraphQL lens schema built',
      );
      return built;
    });
    const entry: LensEntry = { schema };
    space.schemas.set(key, entry);
    // A failed build is forgotten, so the next request retries.
    schema.catch(() => {
      if (space.schemas.has(key) && space.schemas.entries().some(([, value]) => value === entry)) {
        space.schemas.delete(key);
      }
    });
    return schema;
  };

  const listLens = () =>
    [...spaces.values()].flatMap(({ siteId, visibility, schemas }) =>
      schemas.entries().map(([view, , segment]) => ({ siteId, visibility, view, segment })),
    );

  return {
    get: (view, visibility = FULL_VISIBILITY) => ensure(view, visibility, true),
    getLens,
    listLens,
    refresh,
    peek: (siteId, visibilityKey = FULL_VISIBILITY.key) =>
      entries.get(entryKey(siteId, visibilityKey))?.built,
    list: () =>
      [...entries.values()].map((entry) => ({
        siteId: entry.siteId,
        visibility: entry.visibility.key,
        version: entry.built?.version ?? null,
      })),
    close: () => {
      closed = true;
    },
  };
};
