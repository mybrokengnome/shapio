import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { createSite, deleteSite, getSite, listSites, updateSite } from '../../../controllers/sites.js';
import { declareSiteScope } from '../../../plugins/siteResolution.js';
import {
  createSiteSchema,
  deleteSiteSchema,
  getSiteSchema,
  listSitesSchema,
  updateSiteSchema,
} from './schemas.js';

/**
 * /api/admin/sites (sites plan §H): network routes. Any admin lists the sites they work on (the site
 * switcher); creating, renaming and deleting sites needs `sites.manage`, a network action.
 */
export const adminSitesRoutes: FastifyPluginAsyncTypebox = async (app) => {
  declareSiteScope(app, 'network');
  const admin = { preHandler: app.requireAdmin };
  const manageSites = { preHandler: app.requireGlobalPermission('sites.manage') };

  // GET /api/admin/sites
  app.get('/', { schema: listSitesSchema, ...admin }, listSites);
  // GET /api/admin/sites/:id
  app.get('/:id', { schema: getSiteSchema, ...admin }, getSite);
  // POST /api/admin/sites
  app.post(
    '/',
    { schema: createSiteSchema, config: { audit: { action: 'site.create' } }, ...manageSites },
    createSite,
  );
  // PATCH /api/admin/sites/:id: rename, with the expected version (409 when stale)
  app.patch(
    '/:id',
    { schema: updateSiteSchema, config: { audit: { action: 'site.update' } }, ...manageSites },
    updateSite,
  );
  // DELETE /api/admin/sites/:id: only an empty site, never the primary one
  app.delete(
    '/:id',
    { schema: deleteSiteSchema, config: { audit: { action: 'site.delete' } }, ...manageSites },
    deleteSite,
  );
};
