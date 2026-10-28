import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { getSiteChangeSets, updateSiteChangeSets } from '../../../controllers/siteChangeSets.js';
import { getSiteSeo, updateSiteSeo } from '../../../controllers/siteSeo.js';
import { declareSiteScope } from '../../../plugins/siteResolution.js';
import {
  getSiteChangeSetsSchema,
  getSiteSeoSchema,
  updateSiteChangeSetsSchema,
  updateSiteSeoSchema,
} from './schemas.js';

/**
 * /api/admin/site: the request's site's own settings (plan seo-fields; change set settings, plan approval-workflows), named by the `Shapio-Site` header.
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
  // GET /api/admin/site/change-sets: the approval mode, the site's workflow, the inherited and the effective one
  // (any admin of the site)
  app.get(
    '/change-sets',
    { schema: getSiteChangeSetsSchema, preHandler: app.requireAdmin },
    getSiteChangeSets,
  );
  // PUT /api/admin/site/change-sets { expectedVersion, mode, workflow? }: 409 when the site changed since read
  app.put(
    '/change-sets',
    {
      schema: updateSiteChangeSetsSchema,
      config: { audit: { action: 'site.change_sets_update' } },
      ...settings,
    },
    updateSiteChangeSets,
  );
};
