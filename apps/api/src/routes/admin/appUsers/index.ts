import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import * as handlers from '../../../controllers/appUsers.js';
import * as schemas from './schemas.js';

/** App users as administrators see them (Users → App users). Everything needs users.manage. */
export const adminAppUsersRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const manageUsers = { preHandler: app.requireGlobalPermission('users.manage') };

  // GET /api/admin/app-users?search=&cursor=&limit=
  app.get('/', { schema: schemas.listAppUsersSchema, ...manageUsers }, handlers.listAppUsers);
  // GET /api/admin/app-users/:id
  app.get('/:id', { schema: schemas.getAppUserSchema, ...manageUsers }, handlers.getAppUser);
  // PATCH /api/admin/app-users/:id { blocked?, roleIds? }
  app.patch(
    '/:id',
    { schema: schemas.updateAppUserSchema, config: { audit: { action: 'app_user.update' } }, ...manageUsers },
    handlers.updateAppUser,
  );
  // DELETE /api/admin/app-users/:id
  app.delete(
    '/:id',
    { schema: schemas.deleteAppUserSchema, config: { audit: { action: 'app_user.delete' } }, ...manageUsers },
    handlers.deleteAppUser,
  );
  // POST /api/admin/app-users/:id/resend-confirmation
  app.post(
    '/:id/resend-confirmation',
    {
      schema: schemas.resendConfirmationSchema,
      config: { audit: { action: 'app_user.confirmation_resend' } },
      ...manageUsers,
    },
    handlers.resendConfirmation,
  );
};
