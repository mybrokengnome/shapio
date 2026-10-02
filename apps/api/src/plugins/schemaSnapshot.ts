import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { NotificationListener } from '../db/notifications.js';
import { startSchemaChangeListener } from '../schema/notify.js';
import type { SchemaContentPorts } from '../schema/planner/contentPorts.js';
import type { SchemaRegistry } from '../schema/registry.js';
import type { SchemaSnapshot } from '../schema/snapshot.js';

declare module 'fastify' {
  interface FastifyInstance {
    schemaRegistry: SchemaRegistry;
    /** Content storage as the schema planner sees it (package E provides the real ports). */
    schemaContent: SchemaContentPorts;
  }
  interface FastifyRequest {
    /** Set on first use by `getRequestSchema`; the same snapshot for the rest of the request. */
    schemaSnapshotPin: Promise<SchemaSnapshot> | null;
  }
}

type SchemaSnapshotPluginOptions = {
  /** Refresh caches early via LISTEN/NOTIFY. Off still works: requests check the durable version. */
  /** Created by buildApp before the permission evaluator, which reads field visibility from it. */
  registry: SchemaRegistry;
  listen: boolean;
  contentPorts: SchemaContentPorts;
};

/**
 * The schema registry and per-request snapshot pinning (ADR 0002). The pin is lazy: requests that never
 * touch the schema (health, static admin) pay nothing; the first call in a request does the version check.
 */
export const schemaSnapshotPlugin = fp<SchemaSnapshotPluginOptions>(
  async (app: FastifyInstance, { registry, listen, contentPorts }) => {
    app.decorate('schemaRegistry', registry);
    app.decorate('schemaContent', contentPorts);
    app.decorateRequest('schemaSnapshotPin', null);

    let listener: NotificationListener | undefined;
    if (listen) {
      app.addHook('onReady', async () => {
        listener = startSchemaChangeListener({
          connectionString: app.config.database.url,
          registry,
          log: app.log.child({ component: 'schema-listen' }),
        });
      });
    }
    app.addHook('onClose', async () => {
      await listener?.close();
    });
  },
  { name: 'shapio-schema-snapshot', dependencies: ['shapio-services'] },
);

/** The schema snapshot this request is pinned to. */
export const getRequestSchema = (request: FastifyRequest): Promise<SchemaSnapshot> => {
  request.schemaSnapshotPin ??= request.server.schemaRegistry.getSnapshot();
  return request.schemaSnapshotPin;
};
