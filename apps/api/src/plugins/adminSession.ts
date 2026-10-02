import cookie from '@fastify/cookie';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import fp from 'fastify-plugin';
import { SESSION_COOKIE_NAME } from '../constants/auth.js';
import { AppError } from '../helpers/appError.js';
import type { UrlBuilder } from '../helpers/publicUrl.js';
import { toClientInfo } from '../helpers/requestContext.js';
import type { GlobalAction, Principal } from '../permissions/types.js';
import { resolveSession } from '../services/adminSessions.js';
import { isApiTokenFormat, resolveApiToken } from '../services/apiTokens.js';

/** `appToken`: an app-user JWT, resolved by plugins/appUserAuth.ts. */
export type AuthMethod = 'none' | 'session' | 'token' | 'appToken';

declare module 'fastify' {
  interface FastifyRequest {
    /** Who is calling. Anonymous unless a session cookie or API token resolved. Never null after onRequest. */
    principal: Principal;
    /** How the principal authenticated. CSRF checks apply to `session`. */
    authMethod: AuthMethod;
    /**
     * The session's server-side CSRF secret, in the shape @fastify/csrf-protection's session mode reads
     * (`request.session._csrf`). Empty without a session.
     */
    session: { _csrf?: string };
  }
  interface FastifyReply {
    setSessionCookie: (session: { token: string; expiresAt: Date }) => FastifyReply;
    clearSessionCookie: () => FastifyReply;
  }
  interface FastifyInstance {
    /** An admin user (session) or an admin-scope API token. */
    requireAdmin: preHandlerAsyncHookHandler;
    /** A signed-in admin user (session only): profile, password, own sessions. */
    requireAdminSession: preHandlerAsyncHookHandler;
    /** An admin principal whose roles grant the instance-level action. */
    requireGlobalPermission: (action: GlobalAction) => preHandlerAsyncHookHandler;
  }
}

type AdminSessionOptions = { urls: UrlBuilder; secureCookies: boolean };

const ANONYMOUS: Principal = Object.freeze({ kind: 'anonymous' });
const BEARER = /^Bearer\s+(\S+)$/i;

const unauthenticated = () => new AppError(401, 'UNAUTHENTICATED', 'Sign in to continue');

const isAdminPrincipal = (principal: Principal) =>
  principal.kind === 'admin' || (principal.kind === 'token' && principal.scope === 'admin');

/**
 * Resolves the caller on every API request: an `Authorization: Bearer shp_…` API token, else the
 * `shapio_session` cookie (server-side session, rotated after privilege changes). Exposes route guards.
 */
export const adminSessionPlugin = fp<AdminSessionOptions>(
  async (app: FastifyInstance, { urls, secureCookies }) => {
    await app.register(cookie);
    const apiPrefix = urls.withBasePath('/api/');
    const cookieOptions = {
      path: urls.withBasePath('/'),
      httpOnly: true,
      sameSite: 'lax',
      secure: secureCookies,
    } as const;

    app.decorateRequest('principal');
    app.decorateRequest('authMethod', 'none');
    app.decorateRequest('session');
    app.decorateReply('setSessionCookie', function setSessionCookie(this: FastifyReply, session) {
      return this.setCookie(SESSION_COOKIE_NAME, session.token, {
        ...cookieOptions,
        expires: session.expiresAt,
      });
    });
    app.decorateReply('clearSessionCookie', function clearSessionCookie(this: FastifyReply) {
      return this.clearCookie(SESSION_COOKIE_NAME, cookieOptions);
    });

    const authenticateWithToken = async (request: FastifyRequest, value: string) => {
      const principal = await resolveApiToken(value);
      if (!principal) {
        throw new AppError(401, 'INVALID_TOKEN', 'The API token is invalid, expired or revoked');
      }
      request.principal = principal;
      request.authMethod = 'token';
    };

    const authenticateWithSession = async (request: FastifyRequest, reply: FastifyReply, token: string) => {
      const resolved = await resolveSession(token, toClientInfo(request));
      if (!resolved) {
        reply.clearSessionCookie();
        return;
      }
      request.principal = resolved.principal;
      request.authMethod = 'session';
      request.session = { _csrf: resolved.csrfSecret };
      if (resolved.rotated) {
        reply.setSessionCookie(resolved.rotated);
      }
    };

    app.addHook('onRequest', async (request, reply) => {
      request.principal = ANONYMOUS;
      request.authMethod = 'none';
      request.session = {};
      // Static admin assets and redirects need no identity (and no database round trip).
      if (!request.url.startsWith(apiPrefix)) {
        return;
      }
      const bearer = BEARER.exec(request.headers.authorization ?? '')?.[1];
      if (bearer !== undefined && isApiTokenFormat(bearer)) {
        await authenticateWithToken(request, bearer);
        return;
      }
      // Other bearer values (app-user JWTs) are resolved by plugins/appUserAuth.ts. An explicit bearer
      // credential wins over an ambient session cookie, so the request never acts as both.
      if (bearer !== undefined) {
        return;
      }
      const sessionToken = request.cookies[SESSION_COOKIE_NAME];
      if (sessionToken) {
        await authenticateWithSession(request, reply, sessionToken);
      }
    });

    const requireAdmin: preHandlerAsyncHookHandler = async (request) => {
      if (isAdminPrincipal(request.principal)) {
        return;
      }
      throw request.principal.kind === 'anonymous'
        ? unauthenticated()
        : new AppError(403, 'FORBIDDEN', 'This needs an admin account or an admin API token');
    };
    app.decorate('requireAdmin', requireAdmin);
    app.decorate('requireAdminSession', async (request: FastifyRequest) => {
      if (request.principal.kind !== 'admin') {
        throw unauthenticated();
      }
    });
    app.decorate('requireGlobalPermission', (action: GlobalAction): preHandlerAsyncHookHandler => {
      return async function requireGlobalPermission(this: FastifyInstance, request, reply) {
        await requireAdmin.call(this, request, reply);
        if (!(await app.permissions.canPerform(request.principal, action))) {
          throw new AppError(403, 'FORBIDDEN', `Your role does not allow ${action}`);
        }
      };
    });
  },
  { name: 'shapio-admin-session', dependencies: ['shapio-services'] },
);
