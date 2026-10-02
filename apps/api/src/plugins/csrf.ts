import csrfProtection from '@fastify/csrf-protection';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { CSRF_HEADER } from '../constants/auth.js';

declare module 'fastify' {
  interface FastifyContextConfig {
    /**
     * `false` for credential endpoints (login, setup, invitation accept, password reset) that authenticate
     * by what is in the body and never act with the session cookie. They accept JSON only, which a
     * cross-site form cannot send, and they are rate-limited.
     */
    csrf?: boolean;
  }
}

const MUTATING_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * CSRF protection for cookie-authenticated mutations (ADR 0005), including GraphQL POSTs later. The secret
 * is server-side and bound to the session (`admin_sessions.csrf_secret`, exposed by the session plugin
 * as `request.session._csrf`, which is how @fastify/csrf-protection's session mode reads it). Clients get
 * a token from login/setup/me or GET /api/admin/auth/csrf and send it in `X-CSRF-Token`. Bearer-token and
 * anonymous requests carry no ambient credentials, so they are not checked.
 */
export const csrfPlugin = fp(
  async (app: FastifyInstance) => {
    await app.register(csrfProtection, {
      sessionPlugin: '@fastify/session',
      sessionKey: '_csrf',
      // Only the header: tokens in bodies or query strings end up in logs and caches.
      getToken: (request) => {
        const value = request.headers[CSRF_HEADER];
        return typeof value === 'string' ? value : undefined;
      },
    });
    app.addHook('onRequest', (request, reply, done) => {
      if (
        request.authMethod !== 'session' ||
        !MUTATING_METHODS.has(request.method) ||
        request.routeOptions.config.csrf === false
      ) {
        done();
        return;
      }
      app.csrfProtection(request, reply, done);
    });
  },
  { name: 'shapio-csrf', dependencies: ['shapio-admin-session'] },
);
