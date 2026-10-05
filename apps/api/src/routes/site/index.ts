import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { getDeliverySite } from '../../controllers/site.js';
import { declareSiteScope } from '../../plugins/siteResolution.js';
import { getDeliverySiteSchema } from './schemas.js';

/**
 * /api/site (plan seo-fields): the delivery view of the request's site (token, `Shapio-Site` or `?site=`):
 * its key, name and SEO defaults, for pages without an entry and for GraphQL users merging SEO themselves.
 * Readable by any caller that reads content on the site; cacheable like delivery reads.
 */
export const siteRoutes: FastifyPluginAsyncTypebox = async (app) => {
  declareSiteScope(app, 'site');
  // GET /api/site
  app.get('/', { schema: getDeliverySiteSchema }, getDeliverySite);
};
