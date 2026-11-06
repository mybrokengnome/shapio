import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { getSiteAppRoles, setSiteAppRoles } from '../../../controllers/siteAppRoles.js';
import {
  createSite,
  deleteSite,
  getSite,
  listSites,
  makePrimarySite,
  updateSite,
} from '../../../controllers/sites.js';
import { declareSiteScope } from '../../../plugins/siteResolution.js';
import { getSiteAppRolesSchema, setSiteAppRolesSchema } from './appRoleSchemas.js';
import {
  createSiteSchema,
  deleteSiteSchema,
  getSiteSchema,
  listSitesSchema,
  makePrimarySiteSchema,
  updateSiteSchema,
} from './schemas.js';

/**
 * /api/admin/sites (sites plan §H): network routes. Any admin lists the sites they work on (the site
 * switcher); creating, renaming, deleting sites and making one primary needs `sites.manage`, a network action.
 */
export const adminSitesRoutes: FastifyPluginAsyncTypebox = async (app) => {
  declareSiteScope(app, 'network');
  const admin = { preHandler: app.requireAdmin };
  const manageSites = { preHandler: app.requireGlobalPermission('sites.manage') };
  const manageRoles = { preHandler: app.requireGlobalPermission('roles.manage') };

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
  // DELETE /api/admin/sites/:id: only an empty site, and not while it is the primary one
  app.delete(
    '/:id',
    { schema: deleteSiteSchema, config: { audit: { action: 'site.delete' } }, ...manageSites },
    deleteSite,
  );
  // POST /api/admin/sites/:id/make-primary: requests that name no site go to this site from now on
  app.post(
    '/:id/make-primary',
    { schema: makePrimarySiteSchema, config: { audit: { action: 'site.make_primary' } }, ...manageSites },
    makePrimarySite,
  );
  // GET /api/admin/sites/:id/app-roles: the app roles bound to the site's anonymous callers (`public`) and
  // signed-in app users (`authenticated`).
  app.get('/:id/app-roles', { schema: getSiteAppRolesSchema, ...admin }, getSiteAppRoles);
  // PUT /api/admin/sites/:id/app-roles { public, authenticated }: replaces the bindings (roles.manage).
  app.put(
    '/:id/app-roles',
    {
      schema: setSiteAppRolesSchema,
      config: { audit: { action: 'site.app_roles_update' } },
      ...manageRoles,
    },
    setSiteAppRoles,
  );
};
