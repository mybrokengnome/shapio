import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { CREDENTIAL_RATE_LIMIT_PER_IP } from '../../constants/auth.js';
import * as handlers from '../../controllers/appAuth.js';
import { createPerEmailRateLimit, CREDENTIAL_ROUTE_CONFIG } from '../admin/rateLimits.js';
import * as schemas from './schemas.js';

/** Credential routes (no CSRF, tight per-IP limit) that also ignore any app-user bearer token. */
const PUBLIC_CREDENTIAL = { ...CREDENTIAL_ROUTE_CONFIG, appToken: 'ignore' } as const;

/**
 * /api/app-auth: sign-up, sign-in and account endpoints for app users (the end users of sites and apps built
 * on Shapio). Credentials travel in JSON bodies and tokens in the Authorization header, never in cookies
 * (except the OAuth round trip's state), so no CSRF token is needed. Credential endpoints have a tight
 * per-IP limit and, where an email is given, a per-address limit. CORS follows CORS_ORIGINS.
 */
export const appAuthRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const signedIn = { preHandler: app.requireAppUser };
  // Bearer-authenticated (CSRF never applies to bearer requests); borrow the credential per-IP limit.
  const signedInCredential = { rateLimit: CREDENTIAL_RATE_LIMIT_PER_IP };

  // POST /api/app-auth/register
  app.post(
    '/register',
    {
      schema: schemas.registerSchema,
      config: { audit: { action: 'app_user.register' }, ...PUBLIC_CREDENTIAL },
      ...createPerEmailRateLimit(app, 'app-register'),
    },
    handlers.register,
  );
  // POST /api/app-auth/login
  app.post(
    '/login',
    {
      schema: schemas.loginSchema,
      config: {
        audit: { exempt: 'end-user sign-ins are high volume; failures are rate-limited per IP and email' },
        ...PUBLIC_CREDENTIAL,
      },
      ...createPerEmailRateLimit(app, 'app-login', {
        counts: (statusCode) => statusCode === 401,
        perClient: true,
      }),
    },
    handlers.login,
  );
  // POST /api/app-auth/refresh: rotates the refresh token (reuse revokes the family and is audited).
  app.post(
    '/refresh',
    {
      schema: schemas.refreshSchema,
      config: {
        audit: { exempt: 'token rotation; reuse detection is audited by the service' },
        csrf: false,
        appToken: 'ignore',
      },
    },
    handlers.refresh,
  );
  // POST /api/app-auth/logout: revokes the refresh token's family and signs the account out everywhere: every
  // access token it holds is refused from the next request (other logins recover through their refresh).
  app.post(
    '/logout',
    {
      schema: schemas.logoutSchema,
      config: {
        audit: { exempt: 'ends one end-user sign-in; nothing to review' },
        csrf: false,
        appToken: 'ignore',
      },
    },
    handlers.logout,
  );
  // GET /api/app-auth/me
  app.get('/me', { schema: schemas.getMeSchema, ...signedIn }, handlers.getMe);
  // PATCH /api/app-auth/me
  app.patch(
    '/me',
    {
      schema: schemas.updateMeSchema,
      config: { audit: { exempt: 'an app user editing their own display name' } },
      ...signedIn,
    },
    handlers.updateMe,
  );
  // POST /api/app-auth/me/password: needs the current password when the account has one.
  app.post(
    '/me/password',
    {
      schema: schemas.changePasswordSchema,
      config: { audit: { action: 'app_user.password_change' }, ...signedInCredential },
      ...signedIn,
    },
    handlers.changePassword,
  );
  // DELETE /api/app-auth/me: deletes the caller's account.
  app.delete(
    '/me',
    {
      schema: schemas.deleteMeSchema,
      config: { audit: { action: 'app_user.delete' }, ...signedInCredential },
      ...signedIn,
    },
    handlers.deleteMe,
  );
  // POST /api/app-auth/confirm-email { token }
  app.post(
    '/confirm-email',
    {
      schema: schemas.confirmEmailSchema,
      config: { audit: { action: 'app_user.confirm_email' }, ...PUBLIC_CREDENTIAL },
    },
    handlers.confirmEmail,
  );
  // POST /api/app-auth/confirm-email/resend { email }: always 202.
  app.post(
    '/confirm-email/resend',
    {
      schema: schemas.emailRequestSchema,
      config: {
        audit: { exempt: 'sends an email; the confirmation itself is audited' },
        ...PUBLIC_CREDENTIAL,
      },
      ...createPerEmailRateLimit(app, 'app-confirm-resend'),
    },
    handlers.resendConfirmation,
  );
  // POST /api/app-auth/password-reset { email }: always 202.
  app.post(
    '/password-reset',
    {
      schema: schemas.emailRequestSchema,
      config: { audit: { action: 'app_user.password_reset_request' }, ...PUBLIC_CREDENTIAL },
      ...createPerEmailRateLimit(app, 'app-password-reset'),
    },
    handlers.requestPasswordReset,
  );
  // POST /api/app-auth/password-reset/confirm { token, password }
  app.post(
    '/password-reset/confirm',
    {
      schema: schemas.confirmResetSchema,
      config: { audit: { action: 'app_user.password_reset' }, ...PUBLIC_CREDENTIAL },
    },
    handlers.confirmPasswordReset,
  );
  // GET /api/app-auth/providers: the configured OAuth providers.
  app.get(
    '/providers',
    { schema: schemas.providersSchema, config: { appToken: 'ignore' } },
    handlers.listProviders,
  );
  // GET /api/app-auth/oauth/:provider/start?redirectTo=…&codeChallenge=…: redirects to the provider.
  app.get(
    '/oauth/:provider/start',
    {
      schema: schemas.oauthStartSchema,
      config: { rateLimit: CREDENTIAL_RATE_LIMIT_PER_IP, appToken: 'ignore' },
    },
    handlers.startOAuth,
  );
  // GET /api/app-auth/oauth/:provider/callback: the provider's redirect; sends the browser back to the app.
  app.get(
    '/oauth/:provider/callback',
    {
      schema: schemas.oauthCallbackSchema,
      config: { rateLimit: CREDENTIAL_RATE_LIMIT_PER_IP, appToken: 'ignore' },
    },
    handlers.completeOAuth,
  );
  // POST /api/app-auth/oauth/exchange { code, codeVerifier }: the app trades its one-time code for tokens.
  app.post(
    '/oauth/exchange',
    {
      schema: schemas.oauthExchangeSchema,
      config: {
        audit: { exempt: 'completes a sign-in already audited at the callback' },
        ...PUBLIC_CREDENTIAL,
      },
    },
    handlers.exchangeOAuthCode,
  );
};
