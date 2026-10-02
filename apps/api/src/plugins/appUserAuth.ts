import type { FastifyInstance, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import fp from 'fastify-plugin';
import type { OAuthEndpoints, OAuthProviderId } from '../appAuth/oauth/types.js';
import { createAppAuthRuntime, type AppAuthRuntime } from '../appAuth/runtime.js';
import type { AppAuthConfig } from '../config/index.js';
import { AppError } from '../helpers/appError.js';
import type { UrlBuilder } from '../helpers/publicUrl.js';
import { isApiTokenFormat } from '../services/apiTokens.js';
import { resolveAccessToken } from '../services/appAuthSessions.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** App-user authentication: config, derived keys, OAuth providers (package I). */
    appAuth: AppAuthRuntime;
    /** A signed-in app user (access token). */
    requireAppUser: preHandlerAsyncHookHandler;
  }
  interface FastifyContextConfig {
    /**
     * `ignore`: the route authenticates by its body (sign-in, refresh, links), so an `Authorization` header
     * with an expired app-user token, which clients often attach to every call, must not reject it.
     */
    appToken?: 'ignore';
  }
}

type AppUserAuthOptions = {
  config: AppAuthConfig;
  urls: UrlBuilder;
  signingSecret: string;
  corsOrigins: readonly string[];
  oauthEndpoints?: Partial<Record<OAuthProviderId, OAuthEndpoints>>;
};

const BEARER = /^Bearer\s+(\S+)$/i;

const invalidToken = () =>
  new AppError(401, 'INVALID_TOKEN', 'The access token is invalid or expired, or the account cannot sign in');

/**
 * Resolves app users from `Authorization: Bearer <JWT>` on API requests (the admin-session plugin leaves
 * bearer values that are not API tokens to this plugin). An invalid token is a 401, never a silent
 * downgrade to anonymous. Bearer requests carry no ambient credentials, so CSRF does not apply to them.
 */
export const appUserAuthPlugin = fp<AppUserAuthOptions>(
  async (app: FastifyInstance, options) => {
    const runtime = createAppAuthRuntime(options);
    const apiPrefix = options.urls.withBasePath('/api/');
    app.decorate('appAuth', runtime);

    app.addHook('onRequest', async (request: FastifyRequest) => {
      if (!request.url.startsWith(apiPrefix) || request.routeOptions.config.appToken === 'ignore') {
        return;
      }
      const bearer = BEARER.exec(request.headers.authorization ?? '')?.[1];
      if (bearer === undefined || isApiTokenFormat(bearer)) {
        return;
      }
      const principal = await resolveAccessToken(runtime, bearer);
      if (!principal) {
        throw invalidToken();
      }
      request.principal = principal;
      request.authMethod = 'appToken';
      request.session = {};
    });

    app.decorate('requireAppUser', async (request: FastifyRequest) => {
      if (request.principal.kind !== 'appUser') {
        throw new AppError(401, 'UNAUTHENTICATED', 'Sign in with an app-user access token');
      }
    });
  },
  { name: 'shapio-app-user-auth', dependencies: ['shapio-admin-session'] },
);
