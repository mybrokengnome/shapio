import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import {
  acceptInvitation,
  createInvitation,
  deleteUser,
  getUser,
  inspectInvitation,
  issueInvitationLink,
  listInvitations,
  listUsers,
  revokeInvitation,
  revokeUserSessions,
  updateUser,
} from '../../../controllers/adminUsers.js';
import { declareSiteScope } from '../../../plugins/siteResolution.js';
import { CREDENTIAL_ROUTE_CONFIG } from '../rateLimits.js';
import {
  acceptInvitationSchema,
  createInvitationSchema,
  deleteUserSchema,
  getUserSchema,
  inspectInvitationSchema,
  invitationLinkSchema,
  listInvitationsSchema,
  listUsersSchema,
  revokeInvitationSchema,
  revokeUserSessionsSchema,
  updateUserSchema,
} from './schemas.js';

/** Admin users and invitations. Registered under /api/admin. */
export const adminUsersRoutes: FastifyPluginAsyncTypebox = async (app) => {
  declareSiteScope(app, 'network');
  const manageUsers = { preHandler: app.requireGlobalPermission('users.manage') };

  // GET /api/admin/users
  app.get('/users', { schema: listUsersSchema, ...manageUsers }, listUsers);
  // GET /api/admin/users/:id
  app.get('/users/:id', { schema: getUserSchema, ...manageUsers }, getUser);
  // PATCH /api/admin/users/:id
  app.patch(
    '/users/:id',
    { schema: updateUserSchema, config: { audit: { action: 'admin_user.update' } }, ...manageUsers },
    updateUser,
  );
  // DELETE /api/admin/users/:id
  app.delete(
    '/users/:id',
    { schema: deleteUserSchema, config: { audit: { action: 'admin_user.delete' } }, ...manageUsers },
    deleteUser,
  );
  // DELETE /api/admin/users/:id/sessions: sign the user out everywhere.
  app.delete(
    '/users/:id/sessions',
    { schema: revokeUserSessionsSchema, config: { audit: { action: 'session.revoke_all' } }, ...manageUsers },
    revokeUserSessions,
  );

  // GET /api/admin/invitations: pending invitations.
  app.get('/invitations', { schema: listInvitationsSchema, ...manageUsers }, listInvitations);
  // POST /api/admin/invitations
  app.post(
    '/invitations',
    { schema: createInvitationSchema, config: { audit: { action: 'invitation.create' } }, ...manageUsers },
    createInvitation,
  );
  // DELETE /api/admin/invitations/:id
  app.delete(
    '/invitations/:id',
    { schema: revokeInvitationSchema, config: { audit: { action: 'invitation.revoke' } }, ...manageUsers },
    revokeInvitation,
  );
  // POST /api/admin/invitations/:id/link: a fresh accept link to send by hand; earlier links stop working.
  app.post(
    '/invitations/:id/link',
    { schema: invitationLinkSchema, config: { audit: { action: 'invitation.link' } }, ...manageUsers },
    issueInvitationLink,
  );
  // POST /api/admin/invitations/inspect: public; the token travels in the body, never in a URL.
  app.post(
    '/invitations/inspect',
    {
      schema: inspectInvitationSchema,
      config: {
        audit: { exempt: 'read-only lookup of an invitation by its token' },
        ...CREDENTIAL_ROUTE_CONFIG,
      },
    },
    inspectInvitation,
  );
  // POST /api/admin/invitations/accept: public; creates the account and signs it in.
  app.post(
    '/invitations/accept',
    {
      schema: acceptInvitationSchema,
      config: { audit: { action: 'invitation.accept' }, ...CREDENTIAL_ROUTE_CONFIG },
    },
    acceptInvitation,
  );
};
