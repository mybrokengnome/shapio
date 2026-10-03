import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import { getDocsPage, getOpenApi, getTypeScript } from '../../controllers/apiDocs.js';
import { declareSiteScope } from '../../plugins/siteResolution.js';

/**
 * /api/docs: the generated API contracts. Admin principals only: the documents describe every model and
 * field, including non-public ones.
 */
export const docsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  declareSiteScope(app, 'network');
  const admin = { preHandler: app.requireAdmin };
  // GET /: self-hosted HTML index (no CDN, no scripts)
  app.get('/', { ...admin, schema: { response: { 200: Type.String() } } }, getDocsPage);
  // GET /openapi.json
  app.get(
    '/openapi.json',
    { ...admin, schema: { response: { 200: Type.Record(Type.String(), Type.Unknown()) } } },
    getOpenApi,
  );
  // GET /typescript: declarations for `shapio types generate`
  app.get(
    '/typescript',
    {
      ...admin,
      schema: { response: { 200: Type.Object({ schemaVersion: Type.Integer(), source: Type.String() }) } },
    },
    getTypeScript,
  );
};
