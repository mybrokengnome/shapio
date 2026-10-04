import type { FastifyBaseLogger } from 'fastify';
import { GRAPHQL_SITE_SCHEMA_IDLE_MS } from '../../../constants/graphql.js';
import type { NetworkSchema, SchemaSnapshot } from '../../snapshot.js';
import { buildGraphqlSchema, type BuiltSchema } from './schemaBuilder.js';

/**
 * The GraphQL schemas of the sites' views (ADR 0006), keyed by (site, global schema version). Each request
 * asks for its pinned view: a site's schema is built on its first request, one build per (site, version)
 * however many requests wait for it, and replaces the site's older schema once built (a failed build keeps
 * the older one; the next request retries). A site's schema never moves backwards: a request pinned to an
 * older version than the cached schema is served the cached one. Sites no request has used for
 * GRAPHQL_SITE_SCHEMA_IDLE_MS are dropped, so memory follows the sites in use.
 */
export type GraphqlSchemaCache = {
  get: (view: SchemaSnapshot) => Promise<BuiltSchema>;
  /**
   * A new schema version is known (LISTEN/NOTIFY): rebuilds, in the background and one site at a time, the
   * sites that already have a schema. Sites never asked for are left for their first request.
   */
  refresh: (network: NetworkSchema) => void;
  /** The cached schema of a site, if any (tests and diagnostics). */
  peek: (siteId: string | null) => BuiltSchema | undefined;
  /** Stops background rebuilds (app shutdown). */
  close: () => void;
};

type SiteEntry = {
  built?: BuiltSchema;
  pending?: { version: number; promise: Promise<BuiltSchema> };
  lastSeen: number;
};

type SchemaCacheOptions = {
  log: FastifyBaseLogger;
  now?: () => number;
  idleMs?: number;
  build?: (view: SchemaSnapshot) => BuiltSchema;
};

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

export const createGraphqlSchemaCache = ({
  log,
  now = Date.now,
  idleMs = GRAPHQL_SITE_SCHEMA_IDLE_MS,
  build = buildGraphqlSchema,
}: SchemaCacheOptions): GraphqlSchemaCache => {
  const sites = new Map<string | null, SiteEntry>();
  let lastSweep = now();
  let closed = false;

  const sweep = (time: number) => {
    if (time - lastSweep < idleMs) {
      return;
    }
    lastSweep = time;
    for (const [siteId, entry] of sites) {
      if (!entry.pending && time - entry.lastSeen >= idleMs) {
        sites.delete(siteId);
      }
    }
  };

  const startBuild = (entry: SiteEntry, view: SchemaSnapshot): Promise<BuiltSchema> => {
    const promise: Promise<BuiltSchema> = Promise.resolve().then(() => {
      try {
        const started = performance.now();
        const built = build(view);
        if (!entry.built || built.version > entry.built.version) {
          entry.built = built;
          log.info(
            {
              siteId: view.siteId,
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

  const ensure = (view: SchemaSnapshot, touch: boolean): Promise<BuiltSchema> => {
    const time = now();
    sweep(time);
    let entry = sites.get(view.siteId);
    if (!entry) {
      entry = { lastSeen: time };
      sites.set(view.siteId, entry);
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
    const cached = [...sites].filter(([, entry]) => entry.built).map(([siteId]) => siteId);
    void (async () => {
      for (const siteId of cached) {
        // One build per turn of the event loop, so N sites never block it in one go.
        await yieldToEventLoop();
        if (closed || !sites.has(siteId)) {
          continue;
        }
        const view = siteId === null ? network.shared() : network.forSite(siteId);
        await ensure(view, false).catch((error: unknown) => {
          log.warn(
            { err: error, siteId, schemaVersion: network.version },
            'GraphQL rebuild failed; the next request retries',
          );
        });
      }
    })();
  };

  return {
    get: (view) => ensure(view, true),
    refresh,
    peek: (siteId) => sites.get(siteId)?.built,
    close: () => {
      closed = true;
    },
  };
};
