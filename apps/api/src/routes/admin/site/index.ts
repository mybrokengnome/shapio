import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { getSiteSeo, updateSiteSeo } from '../../../controllers/siteSeo.js';
import { declareSiteScope } from '../../../plugins/siteResolution.js';
import { getSiteSeoSchema, updateSiteSeoSchema } from './schemas.js';

/**
 * /api/admin/site: the request's site's own settings (plan seo-fields), named by the `Shapio-Site` header.
 * Reading them needs read access to some content of the site (checked by the service); changing them needs
 * `site.settings` on that site (a site admin needs no network role).
 */
export const adminSiteRoutes: FastifyPluginAsyncTypebox = async (app) => {
  declareSiteScope(app, 'site');
  const settings = { preHandler: app.requireGlobalPermission('site.settings') };
  // GET /api/admin/site/seo: any admin who reads content on the site (the entry preview shows the template)
  app.get('/seo', { schema: getSiteSeoSchema, preHandler: app.requireAdmin }, getSiteSeo);
  // PUT /api/admin/site/seo { expectedVersion, seo }: 409 when the site changed since it was read
  app.put(
    '/seo',
    { schema: updateSiteSeoSchema, config: { audit: { action: 'site.seo_update' } }, ...settings },
    updateSiteSeo,
  );
};
