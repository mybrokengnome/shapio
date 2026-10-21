import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { listContentTargets } from '../../../controllers/contentTargets.js';
import { declareSiteScope } from '../../../plugins/siteResolution.js';
import { listContentTargetsSchema } from './schemas.js';

/**
 * /api/admin/content-targets: what a relation field may point at, across the models the caller may read (plan
 * interfaces). Admin principals only; read permissions, read masks and row filters are the services'.
 */
export const contentTargetsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  declareSiteScope(app, 'site');
  // GET /?field=&types=&q=&page=&pageSize=&locale=&ids=
  app.get('/', { preHandler: app.requireAdmin, schema: listContentTargetsSchema }, listContentTargets);
};
