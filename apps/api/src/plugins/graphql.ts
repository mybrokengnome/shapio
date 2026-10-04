import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { specifiedRules, type ValidationRule } from 'graphql';
import type { GraphqlConfig } from '../config/graphql.js';
import type { UrlBuilder } from '../helpers/publicUrl.js';
import type { Principal } from '../permissions/types.js';
import { graphqlRoutes } from '../routes/graphql/index.js';
import { createLimitsRule } from '../schema/codegen/graphql/complexity.js';
import { createDocumentCache, type DocumentCache } from '../schema/codegen/graphql/documentCache.js';
import { createGraphqlSchemaCache, type GraphqlSchemaCache } from '../schema/codegen/graphql/schemaCache.js';

/** What `/api/graphql` requests share: the per-site schemas, the validated documents and the rules. */
export type GraphqlRuntime = {
  schemas: GraphqlSchemaCache;
  documents: DocumentCache;
  /** graphql-js's specified rules plus the depth, cost and alias limits. */
  rules: readonly ValidationRule[];
  /** Admin users and API tokens may introspect (anyone, with GRAPHQL_PUBLIC_INTROSPECTION=true). */
  mayIntrospect: (principal: Principal) => boolean;
};

declare module 'fastify' {
  interface FastifyInstance {
    graphqlRuntime: GraphqlRuntime;
  }
}

type GraphqlPluginOptions = { config: GraphqlConfig; urls: UrlBuilder };

/**
 * `/api/graphql` (ADR 0006): graphql-js over one schema per site view, generated in memory from the active
 * registry. Each request pins its schema snapshot, takes its site's view and gets that view's schema from
 * the cache (built on first use, rebuilt when the version moves); no restart is ever needed. Credentials,
 * CSRF (cookie sessions, every method), rate limits and the evaluator are the same as REST's.
 */
export const graphqlPlugin = fp<GraphqlPluginOptions>(
  async (app: FastifyInstance, { config, urls }) => {
    const log = app.log.child({ component: 'graphql' });
    const schemas = createGraphqlSchemaCache({ log });
    app.decorate('graphqlRuntime', {
      schemas,
      documents: createDocumentCache(),
      rules: [...specifiedRules, createLimitsRule(config)],
      mayIntrospect: (principal) =>
        config.publicIntrospection || principal.kind === 'admin' || principal.kind === 'token',
    });

    await app.register(graphqlRoutes, { prefix: urls.withBasePath('/api/graphql') });

    // NOTIFY optimisation: sites already served get their new schema before their next request needs it.
    const unsubscribe = app.schemaRegistry.onChange((network) => schemas.refresh(network));
    app.addHook('onClose', async () => {
      unsubscribe();
      schemas.close();
    });
  },
  {
    name: 'shapio-graphql',
    dependencies: [
      'shapio-services',
      'shapio-schema-snapshot',
      'shapio-csrf',
      'shapio-admin-session',
      'shapio-usage',
    ],
  },
);
