import type { FastifyBaseLogger } from 'fastify';
import type { Database } from '../db/index.js';
import * as schemaVersionsRepository from '../repositories/schemaVersions.js';
import { loadSnapshot, readSnapshot } from './loadSnapshot.js';
import { siteIdsOf, type NetworkSchema } from './snapshot.js';

export type SchemaChangeListener = (snapshot: NetworkSchema) => void;

export type SchemaRegistry = {
  /**
   * The snapshot for the current global schema version. Costs one primary-key read of
   * `system_versions` when the cache is current; reloads (single-flight) when it is not. This durable
   * check is what keeps every instance correct; notifications only make reloads happen sooner.
   * `executor`: the caller's open transaction, which the check (and a reload, when the cache is stale) then
   * reads through, so it never waits for a second pooled connection while holding one.
   * `versions.schemaVersion`: the version the request already read (`repositories/requestState.ts`); the
   * check compares against it instead of reading it again, and still reloads when the cache is older.
   */
  getSnapshot: (executor?: Database, versions?: { schemaVersion?: number }) => Promise<NetworkSchema>;
  /** The cached snapshot without any check (may be stale or absent). */
  peek: () => NetworkSchema | undefined;
  /** A hint that the version moved (NOTIFY). Reloads in the background; never throws. */
  hint: (version?: number) => void;
  /** Called with each newer snapshot once loaded (GraphQL/OpenAPI regeneration, admin live refresh). */
  onChange: (listener: SchemaChangeListener) => () => void;
  /**
   * Ignores later hints and waits for a background reload still in flight. Call on shutdown before the
   * database is closed: a reload that is still acquiring a pooled connection when the pool ends never
   * returns it, and the pool's `end()` then waits forever.
   */
  close: () => Promise<void>;
};

type RegistryOptions = { db: Database; log: FastifyBaseLogger };

export const createSchemaRegistry = ({ db, log }: RegistryOptions): SchemaRegistry => {
  let cached: NetworkSchema | undefined;
  let loading: Promise<NetworkSchema> | undefined;
  let closed = false;
  /** Reloads started by `hint`, which nobody else awaits. */
  const background = new Set<Promise<void>>();
  const listeners = new Set<SchemaChangeListener>();

  const publish = (snapshot: NetworkSchema) => {
    if (cached && cached.version >= snapshot.version) {
      return cached;
    }
    cached = snapshot;
    // Route keys only collide within a view (two sites may each serve `/posts`).
    const views = [snapshot.shared(), ...siteIdsOf(snapshot.definitions).map((id) => snapshot.forSite(id))];
    for (const view of views) {
      for (const collision of view.routeKeyCollisions) {
        log.error(
          { ...collision, siteId: view.siteId, schemaVersion: snapshot.version },
          'two models share a delivery route key; set a plural API ID on the hidden one',
        );
      }
    }
    for (const listener of listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        log.error({ err: error, schemaVersion: snapshot.version }, 'schema change listener failed');
      }
    }
    return snapshot;
  };

  /** Single-flight: concurrent callers share one load; a load that turns out too old is repeated. */
  const loadAtLeast = async (version: number): Promise<NetworkSchema> => {
    for (;;) {
      loading ??= loadSnapshot(db).finally(() => {
        loading = undefined;
      });
      const snapshot = publish(await loading);
      if (snapshot.version >= version) {
        return snapshot;
      }
    }
  };

  return {
    getSnapshot: async (executor, versions) => {
      const version =
        versions?.schemaVersion ?? (await schemaVersionsRepository.getSchemaVersion(executor ?? db));
      if (cached && cached.version >= version) {
        return cached;
      }
      // Through the caller's transaction: this caller's own read, not cached, since a transaction that is
      // not REPEATABLE READ can see an activation commit between its reads. The pool path refreshes the cache.
      return executor ? readSnapshot(executor) : loadAtLeast(version);
    },
    peek: () => cached,
    hint: (version) => {
      if (closed || (version !== undefined && cached && cached.version >= version)) {
        return;
      }
      const reload = loadAtLeast(version ?? 0).then(
        () => undefined,
        (error: unknown) => {
          log.warn({ err: error }, 'schema snapshot refresh failed; the next request will retry');
        },
      );
      background.add(reload);
      void reload.finally(() => background.delete(reload));
    },
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close: async () => {
      closed = true;
      // Each reload settles without throwing (failures are logged above).
      await Promise.all(background);
    },
  };
};
