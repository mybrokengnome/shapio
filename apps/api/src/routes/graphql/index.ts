import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import { PLAYGROUND_QUERY_MAX_LENGTH, PLAYGROUND_THEMES } from '../../constants/graphql.js';
import { SCHEMA_VERSION_HEADER, SCHEMA_VERSION_QUERY_PARAMETER } from '../../constants/schemaLens.js';
import { SITE_KEY_PATTERN, SITE_QUERY_PARAMETER, WORKSPACE_QUERY_PARAMETER } from '../../constants/sites.js';
import { getGraphql, graphqlErrorHandler, postGraphql } from '../../controllers/graphql.js';
import { getPlaygroundAsset, getPlaygroundPage } from '../../controllers/graphqlPlayground.js';
import { csrfForGet, cacheHeaders } from '../../plugins/graphqlHooks.js';
import { declareSiteScope } from '../../plugins/siteResolution.js';

const siteKey = Type.Optional(Type.String({ pattern: SITE_KEY_PATTERN }));

const operationName = Type.Optional(Type.Union([Type.String(), Type.Null()]));

/** GraphQL-over-HTTP POST body (JSON only; batching is not supported). */
const postBody = Type.Object({
  query: Type.String(),
  variables: Type.Optional(Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()])),
  operationName,
  extensions: Type.Optional(Type.Unknown()),
});

/**
 * The schema version a request reads in (plan schema-lenses), `<schemaId>:<version>`. Read, checked and
 * removed from the query by plugins/schemaLens.ts before validation; declared here so the contract shows it.
 */
const schemaVersion = Type.Optional(
  // No shape or length check here: those come after authorization (the plugin's deferred
  // `SCHEMA_VERSION_INVALID`), so a caller that may not read gets the same answer whatever value it sends.
  Type.String({ description: 'Read in the shape of this schema version (`<schemaId>:<version>`)' }),
);

/** `Shapio-Schema-Version`: queries and mutations in that version's names (plan schema-lenses). */
const headers = Type.Object({ [SCHEMA_VERSION_HEADER]: schemaVersion });

/** GET: queries only; `variables` is a JSON object in the query string. */
const getQuerystring = Type.Object({
  query: Type.String(),
  variables: Type.Optional(Type.String()),
  operationName: Type.Optional(Type.String()),
  [SCHEMA_VERSION_QUERY_PARAMETER]: schemaVersion,
});

/**
 * /api/graphql (ADR 0006): one schema per workspace view (the request's workspace: its token's, `?workspace=`
 * or `Shapio-Workspace` (or their original spellings `?site=` and `Shapio-Site`), else the primary workspace). Registered by plugins/graphql.ts.
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
  app.get('/', { ...options, schema: { headers, querystring: getQuerystring } }, getGraphql);
  // POST /api/graphql: queries and mutations
  app.post('/', { ...options, schema: { headers, body: postBody } }, postGraphql);
};

/**
 * /api/graphql/playground: GraphiQL for admin principals, served from vendored assets (no CDN).
 */
export const graphqlPlaygroundRoutes: FastifyPluginAsyncTypebox = async (app) => {
  declareSiteScope(app, 'network');
  const admin = { preHandler: app.requireAdmin };
  // GET /playground: the GraphiQL page; `?workspace=<key>` (or `?site=`) points it at that workspace's GraphQL
  // endpoint, `?query=` prefills the editor, `?theme=light|dark` fixes GraphiQL's theme
  app.get(
    '/playground',
    {
      ...admin,
      schema: {
        querystring: Type.Object({
          [WORKSPACE_QUERY_PARAMETER]: siteKey,
          [SITE_QUERY_PARAMETER]: siteKey,
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
