import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import { PLAYGROUND_QUERY_MAX_LENGTH, PLAYGROUND_THEMES } from '../../constants/graphql.js';
import { SITE_KEY_PATTERN, SITE_QUERY_PARAMETER } from '../../constants/sites.js';
import { getGraphql, graphqlErrorHandler, postGraphql } from '../../controllers/graphql.js';
import { getPlaygroundAsset, getPlaygroundPage } from '../../controllers/graphqlPlayground.js';
import { csrfForGet, cacheHeaders } from '../../plugins/graphqlHooks.js';
import { declareSiteScope } from '../../plugins/siteResolution.js';

const operationName = Type.Optional(Type.Union([Type.String(), Type.Null()]));

/** GraphQL-over-HTTP POST body (JSON only; batching is not supported). */
const postBody = Type.Object({
  query: Type.String(),
  variables: Type.Optional(Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()])),
  operationName,
  extensions: Type.Optional(Type.Unknown()),
});

/** GET: queries only; `variables` is a JSON object in the query string. */
const getQuerystring = Type.Object({
  query: Type.String(),
  variables: Type.Optional(Type.String()),
  operationName: Type.Optional(Type.String()),
});

/**
 * /api/graphql (ADR 0006): one schema per site view (the request's site: its token's, `?site=` or
 * `Shapio-Site`, else the primary site). Registered by plugins/graphql.ts.
 *
 * No response schema: results are arbitrary JSON shaped by the query (error paths mix strings and list
 * indices), serialized as they are. Errors use the GraphQL envelope (`graphqlErrorHandler`), not REST's.
 */
export const graphqlRoutes: FastifyPluginAsyncTypebox = async (app) => {
  declareSiteScope(app, 'site');
  const options = {
    config: {
      audit: {
        exempt: 'GraphQL mutations call the content services, which record revisions and audit events',
      },
    },
    preHandler: csrfForGet(app),
    onSend: cacheHeaders,
    errorHandler: graphqlErrorHandler,
  };
  // GET /api/graphql?query=…: queries (a mutation is refused with 405)
  app.get('/', { ...options, schema: { querystring: getQuerystring } }, getGraphql);
  // POST /api/graphql: queries and mutations
  app.post('/', { ...options, schema: { body: postBody } }, postGraphql);
};

/**
 * /api/graphql/playground: GraphiQL for admin principals, served from vendored assets (no CDN).
 */
export const graphqlPlaygroundRoutes: FastifyPluginAsyncTypebox = async (app) => {
  declareSiteScope(app, 'network');
  const admin = { preHandler: app.requireAdmin };
  // GET /playground: the GraphiQL page; `?site=<key>` points it at that site's GraphQL endpoint, `?query=`
  // prefills the editor, `?theme=light|dark` fixes GraphiQL's theme
  app.get(
    '/playground',
    {
      ...admin,
      schema: {
        querystring: Type.Object({
          [SITE_QUERY_PARAMETER]: Type.Optional(Type.String({ pattern: SITE_KEY_PATTERN })),
          query: Type.Optional(Type.String({ maxLength: PLAYGROUND_QUERY_MAX_LENGTH })),
          theme: Type.Optional(Type.Enum(PLAYGROUND_THEMES)),
        }),
        response: { 200: Type.String() },
      },
    },
    getPlaygroundPage,
  );
  // GET /playground/:file: GraphiQL, React and the bootstrap script
  app.get(
    '/playground/:file',
    {
      ...admin,
      schema: {
        params: Type.Object({ file: Type.String({ pattern: '^[a-z0-9.-]+$', maxLength: 64 }) }),
        response: { 200: Type.String() },
      },
    },
    getPlaygroundAsset,
  );
};
