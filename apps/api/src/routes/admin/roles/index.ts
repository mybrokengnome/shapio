import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { createRole, deleteRole, getRole, listRoles, updateRole } from '../../../controllers/roles.js';
import {
  createRoleSchema,
  deleteRoleSchema,
  getRoleSchema,
  listRolesSchema,
  updateRoleSchema,
} from './schemas.js';

/** Built-in and custom roles with their grants. Any admin may read them (to assign them); changes need roles.manage. */
export const adminRolesRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const readRoles = { preHandler: app.requireAdmin };
  const manageRoles = { preHandler: app.requireGlobalPermission('roles.manage') };

  // GET /api/admin/roles
  app.get('/', { schema: listRolesSchema, ...readRoles }, listRoles);
  // GET /api/admin/roles/:id
  app.get('/:id', { schema: getRoleSchema, ...readRoles }, getRole);
  // POST /api/admin/roles
  app.post(
    '/',
    { schema: createRoleSchema, config: { audit: { action: 'role.create' } }, ...manageRoles },
    createRole,
  );
  // PATCH /api/admin/roles/:id (expectedVersion required: optimistic concurrency)
  app.patch(
    '/:id',
    { schema: updateRoleSchema, config: { audit: { action: 'role.update' } }, ...manageRoles },
    updateRole,
  );
  // DELETE /api/admin/roles/:id
  app.delete(
    '/:id',
    { schema: deleteRoleSchema, config: { audit: { action: 'role.delete' } }, ...manageRoles },
    deleteRole,
  );
};
