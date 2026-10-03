import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import { SITE_KEY_PATTERN, SITE_QUERY_PARAMETER } from '../../constants/sites.js';
import { getPlaygroundAsset, getPlaygroundPage } from '../../controllers/graphqlPlayground.js';
import { declareSiteScope } from '../../plugins/siteResolution.js';

/**
 * /api/graphql/playground: GraphiQL for admin principals, served from vendored assets (no CDN). The
 * endpoint itself (`/api/graphql`) is registered by plugins/graphql.ts.
 */
export const graphqlPlaygroundRoutes: FastifyPluginAsyncTypebox = async (app) => {
  declareSiteScope(app, 'network');
  const admin = { preHandler: app.requireAdmin };
  // GET /playground: the GraphiQL page; `?site=<key>` points it at that site's GraphQL endpoint
  app.get(
    '/playground',
    {
      ...admin,
      schema: {
        querystring: Type.Object({
          [SITE_QUERY_PARAMETER]: Type.Optional(Type.String({ pattern: SITE_KEY_PATTERN })),
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
