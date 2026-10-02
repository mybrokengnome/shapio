import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { CREDENTIAL_RATE_LIMIT_PER_IP } from '../../../constants/auth.js';
import {
  changePassword,
  confirmPasswordReset,
  getCsrfToken,
  getMe,
  listSessions,
  login,
  logout,
  requestPasswordReset,
  revokeSession,
  updateMe,
} from '../../../controllers/auth.js';
import { createPerEmailRateLimit, CREDENTIAL_ROUTE_CONFIG } from '../rateLimits.js';
import {
  changePasswordSchema,
  confirmResetSchema,
  getCsrfSchema,
  getMeSchema,
  listSessionsSchema,
  loginSchema,
  logoutSchema,
  requestResetSchema,
  revokeSessionSchema,
  updateMeSchema,
} from './schemas.js';

/** Admin sign-in, the signed-in admin's profile and sessions, and password resets. */
export const adminAuthRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const signedIn = { preHandler: app.requireAdminSession };

  // POST /api/admin/auth/login
  app.post(
    '/login',
    {
      schema: loginSchema,
      config: { audit: { action: 'auth.login' }, ...CREDENTIAL_ROUTE_CONFIG },
      ...createPerEmailRateLimit(app, 'login', {
        counts: (statusCode) => statusCode === 401,
        perClient: true,
      }),
    },
    login,
  );
  // POST /api/admin/auth/logout
  app.post(
    '/logout',
    { schema: logoutSchema, config: { audit: { action: 'auth.logout' } }, ...signedIn },
    logout,
  );
  // GET /api/admin/auth/me
  app.get('/me', { schema: getMeSchema, ...signedIn }, getMe);
  // PATCH /api/admin/auth/me
  app.patch(
    '/me',
    { schema: updateMeSchema, config: { audit: { action: 'admin_user.update' } }, ...signedIn },
    updateMe,
  );
  // POST /api/admin/auth/me/password
  app.post(
    '/me/password',
    {
      schema: changePasswordSchema,
      // Signed in: CSRF applies; only the tighter per-IP limit is borrowed.
      config: { audit: { action: 'admin_user.password_change' }, rateLimit: CREDENTIAL_RATE_LIMIT_PER_IP },
      ...signedIn,
    },
    changePassword,
  );
  // GET /api/admin/auth/csrf: a fresh CSRF token for the current session.
  app.get('/csrf', { schema: getCsrfSchema, ...signedIn }, getCsrfToken);
  // GET /api/admin/auth/sessions: the signed-in admin's live sessions.
  app.get('/sessions', { schema: listSessionsSchema, ...signedIn }, listSessions);
  // DELETE /api/admin/auth/sessions/:id
  app.delete(
    '/sessions/:id',
    { schema: revokeSessionSchema, config: { audit: { action: 'session.revoke' } }, ...signedIn },
    revokeSession,
  );
  // POST /api/admin/auth/password-reset: always 202, whether or not the account exists.
  app.post(
    '/password-reset',
    {
      schema: requestResetSchema,
      config: { audit: { action: 'auth.password_reset_request' }, ...CREDENTIAL_ROUTE_CONFIG },
      ...createPerEmailRateLimit(app, 'password-reset'),
    },
    requestPasswordReset,
  );
  // POST /api/admin/auth/password-reset/confirm
  app.post(
    '/password-reset/confirm',
    {
      schema: confirmResetSchema,
      config: { audit: { action: 'auth.password_reset' }, ...CREDENTIAL_ROUTE_CONFIG },
    },
    confirmPasswordReset,
  );
};
