import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import * as handlers from '../../../controllers/appRoles.js';
import { declareSiteScope } from '../../../plugins/siteResolution.js';
import * as schemas from './schemas.js';

/** App roles (built-in public/authenticated plus custom). Any admin may read them; changes need roles.manage. */
export const adminAppRolesRoutes: FastifyPluginAsyncTypebox = async (app) => {
  declareSiteScope(app, 'network');
  const readRoles = { preHandler: app.requireAdmin };
  const manageRoles = { preHandler: app.requireGlobalPermission('roles.manage') };

  // GET /api/admin/app-roles
  app.get('/', { schema: schemas.listAppRolesSchema, ...readRoles }, handlers.listAppRoles);
  // GET /api/admin/app-roles/:id
  app.get('/:id', { schema: schemas.getAppRoleSchema, ...readRoles }, handlers.getAppRole);
  // POST /api/admin/app-roles
  app.post(
    '/',
    { schema: schemas.createAppRoleSchema, config: { audit: { action: 'app_role.create' } }, ...manageRoles },
    handlers.createAppRole,
  );
  // PATCH /api/admin/app-roles/:id (expectedVersion required: optimistic concurrency)
  app.patch(
    '/:id',
    { schema: schemas.updateAppRoleSchema, config: { audit: { action: 'app_role.update' } }, ...manageRoles },
    handlers.updateAppRole,
  );
  // DELETE /api/admin/app-roles/:id
  app.delete(
    '/:id',
    { schema: schemas.deleteAppRoleSchema, config: { audit: { action: 'app_role.delete' } }, ...manageRoles },
    handlers.deleteAppRole,
  );
};
