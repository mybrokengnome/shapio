import type { FastifyBaseLogger } from 'fastify';
import { GRAPHQL_SCHEMA_VARIANTS_MAX, GRAPHQL_SITE_SCHEMA_IDLE_MS } from '../../../constants/graphql.js';
import type { NetworkSchema, SchemaSnapshot } from '../../snapshot.js';
import { buildGraphqlSchema, type BuiltSchema } from './schemaBuilder.js';
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
  build?: (view: SchemaSnapshot, visibility: SchemaVisibility) => BuiltSchema;
};

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

const entryKey = (siteId: string | null, visibilityKey: string) => `${siteId ?? ''}\u0000${visibilityKey}`;

export const createGraphqlSchemaCache = ({
  log,
  now = Date.now,
  idleMs = GRAPHQL_SITE_SCHEMA_IDLE_MS,
  maxEntries = GRAPHQL_SCHEMA_VARIANTS_MAX,
  build = buildGraphqlSchema,
}: SchemaCacheOptions): GraphqlSchemaCache => {
  // Map order is use order (re-inserted on every request), so the first entries are the least recently used.
  const entries = new Map<string, Entry>();
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

  return {
    get: (view, visibility = FULL_VISIBILITY) => ensure(view, visibility, true),
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
