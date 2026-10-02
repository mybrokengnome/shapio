import type { FastifyBaseLogger } from 'fastify';
import type { GraphQLSchema } from 'graphql';
import type { SchemaSnapshot } from '../../snapshot.js';
import { buildGraphqlSchema, type BuiltSchema } from './schemaBuilder.js';

/**
 * The GraphQL schema keyed by global schema version (ADR 0006). Every request calls `ensure` with its pinned
 * snapshot: when the snapshot is newer than the current schema, one rebuild runs (concurrent requests share
 * it) and `apply` swaps it in (mercurius `replaceSchema`, which clears its query and JIT caches). The schema
 * never moves backwards. LISTEN/NOTIFY only makes the rebuild happen before the first request needs it.
 */
export type GraphqlSchemaCache = {
  ensure: (snapshot: SchemaSnapshot) => Promise<void>;
  /** The schema currently served (undefined before the first build). */
  current: () => BuiltSchema | undefined;
};

export const createGraphqlSchemaCache = (
  apply: (schema: GraphQLSchema) => void,
  log: FastifyBaseLogger,
): GraphqlSchemaCache => {
  let current: BuiltSchema | undefined;
  let building: { version: number; promise: Promise<void> } | undefined;

  const rebuild = (snapshot: SchemaSnapshot): Promise<void> => {
    const promise = Promise.resolve().then(() => {
      const started = performance.now();
      const built = buildGraphqlSchema(snapshot);
      if (!current || built.version > current.version) {
        current = built;
        apply(built.schema);
        log.info(
          { schemaVersion: built.version, durationMs: Math.round(performance.now() - started) },
          'GraphQL schema rebuilt',
        );
      }
    });
    building = { version: snapshot.version, promise };
    void promise.finally(() => {
      if (building?.promise === promise) {
        building = undefined;
      }
    });
    return promise;
  };

  const ensure = async (snapshot: SchemaSnapshot): Promise<void> => {
    while (!current || current.version < snapshot.version) {
      if (building && building.version >= snapshot.version) {
        await building.promise;
        continue;
      }
      if (building) {
        // An older build is running: let it finish, then build this newer one.
        await building.promise.catch(() => undefined);
        continue;
      }
      await rebuild(snapshot);
    }
  };

  return { ensure, current: () => current };
};
