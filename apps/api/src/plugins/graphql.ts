import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { Kind, type DocumentNode, type OperationDefinitionNode } from 'graphql';
import mercurius from 'mercurius';
import type { GraphqlConfig } from '../config/graphql.js';
import { contentContextFor } from '../controllers/contentContext.js';
import { AppError } from '../helpers/appError.js';
import type { UrlBuilder } from '../helpers/publicUrl.js';
import type { Principal } from '../permissions/types.js';
import { createLimitsRule, fragmentsOf, selectsIntrospection } from '../schema/codegen/graphql/complexity.js';
import type { GraphqlContext, GraphqlRequestContext } from '../schema/codegen/graphql/context.js';
import { createErrorFormatter } from '../schema/codegen/graphql/errors.js';
import { createLoaders } from '../schema/codegen/graphql/loaders.js';
import { memoizePermissions } from '../schema/codegen/graphql/permissions.js';
import { buildGraphqlSchema } from '../schema/codegen/graphql/schemaBuilder.js';
import { createGraphqlSchemaCache } from '../schema/codegen/graphql/schemaCache.js';
import { buildSnapshot, type SchemaSnapshot } from '../schema/snapshot.js';
import type { ContentServiceContext } from '../services/contentAccess.js';
import { cacheHeaders, collectUsage, csrfForGet, recordUsage } from './graphqlHooks.js';
import { getRequestSchema } from './schemaSnapshot.js';
import { getRequestSite } from './siteResolution.js';

type GraphqlPluginOptions = { config: GraphqlConfig; urls: UrlBuilder };

const isAdminPrincipal = (principal: Principal) =>
  principal.kind === 'admin' || (principal.kind === 'token' && principal.scope === 'admin');

const introspectionDisabled = () =>
  new AppError(
    403,
    'INTROSPECTION_DISABLED',
    'Schema introspection needs an admin session or an API token (or GRAPHQL_PUBLIC_INTROSPECTION=true)',
  );

const operationsOf = (document: DocumentNode) =>
  document.definitions.filter(
    (definition): definition is OperationDefinitionNode => definition.kind === Kind.OPERATION_DEFINITION,
  );

/**
 * `/api/graphql` (ADR 0006): mercurius over a schema generated in memory from the active registry. Each
 * request pins its schema snapshot and, when the snapshot is newer than the served schema, waits for the
 * single-flight rebuild before executing; no restart is ever needed. Credentials, CSRF (cookie sessions,
 * every method), rate limits and the evaluator are the same as REST's.
 */
export const graphqlPlugin = fp<GraphqlPluginOptions>(
  async (app: FastifyInstance, { config, urls }) => {
    const log = app.log.child({ component: 'graphql' });
    const mayIntrospect = (principal: Principal) =>
      config.publicIntrospection || principal.kind === 'admin' || principal.kind === 'token';
    const cache = createGraphqlSchemaCache((schema) => app.graphql.replaceSchema(schema), log);

    const context = (request: FastifyRequest): GraphqlRequestContext => {
      // Read on use, not here: mercurius's error handler also builds a context for requests that site
      // resolution refused (403 SITE_MISMATCH, 404 SITE_NOT_FOUND), which have no site and never execute.
      const site = () => getRequestSite(request);
      const permissions = memoizePermissions(request.server.permissions, request.principal);
      let base: Promise<ContentServiceContext> | undefined;
      const content = async (snapshot: SchemaSnapshot): Promise<ContentServiceContext> => {
        base ??= contentContextFor(request);
        return { ...(await base), snapshot, permissions };
      };
      return {
        request,
        permissions,
        isAdmin: isAdminPrincipal(request.principal),
        get site() {
          return site();
        },
        loaders: createLoaders(() => site().id, content),
        content,
      };
    };

    const pinSchema = async (request: FastifyRequest, reply: FastifyReply) => {
      await cache.ensure(await getRequestSchema(request));
      // mercurius's response schema types error paths as strings; GraphQL paths carry list indices as
      // numbers. Results are plain JSON, so serialize them as they are.
      reply.serializer((payload) => JSON.stringify(payload));
    };
    await app.register(mercurius, {
      // Replaced by the first request's snapshot before anything executes.
      schema: buildGraphqlSchema(buildSnapshot(0, [], [])).schema,
      path: urls.withBasePath('/api/graphql'),
      graphiql: false,
      jit: 0,
      allowBatchedQueries: false,
      context,
      // Callers who may not introspect also get no "Did you mean …?" hints naming schema members.
      errorFormatter: createErrorFormatter(log, {
        hideSuggestions: (formatterContext) => {
          const request = formatterContext?.reply?.request;
          return !request || !mayIntrospect(request.principal);
        },
      }),
      validationRules: [createLimitsRule(config)],
      additionalRouteOptions: {
        config: {
          audit: {
            exempt: 'GraphQL mutations call the content services, which record revisions and audit events',
          },
          // Delivery and admin content reads are about one site (its token's, `?site=`, else the primary).
          site: 'site',
        },
        preHandler: [csrfForGet(app), pinSchema],
        onSend: cacheHeaders,
      },
    });

    app.graphql.addHook('preExecution', async (_schema, document, executionContext) => {
      const { request } = executionContext as unknown as GraphqlContext;
      if (mayIntrospect(request.principal)) {
        return;
      }
      const fragments = fragmentsOf(document.definitions);
      if (
        operationsOf(document).some((operation) => selectsIntrospection(operation.selectionSet, fragments))
      ) {
        throw introspectionDisabled();
      }
    });

    // Field usage: selections walked once per operation, counted when it resolves with data.
    app.graphql.addHook('preExecution', (schema, document, executionContext, variables) => {
      const { request } = executionContext as unknown as GraphqlContext;
      collectUsage(request, schema, document, variables);
    });
    app.graphql.addHook('onResolution', (execution, executionContext) => {
      const { request } = executionContext as unknown as GraphqlContext;
      recordUsage(request, execution.data !== null && execution.data !== undefined);
    });

    // NOTIFY optimisation: rebuild as soon as this instance learns of a new version.
    const unsubscribe = app.schemaRegistry.onChange((snapshot) => {
      cache.ensure(snapshot).catch((error: unknown) => {
        log.warn(
          { err: error, schemaVersion: snapshot.version },
          'GraphQL rebuild failed; the next request retries',
        );
      });
    });
    app.addHook('onClose', async () => {
      unsubscribe();
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
