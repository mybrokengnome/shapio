import type { FastifyReply, FastifyRequest } from 'fastify';
import { OAUTH_STATE_COOKIE_NAME } from '../constants/appAuth.js';
import { toActorContext, toClientInfo, toSiteActorContext } from '../helpers/requestContext.js';
import type {
  ChangePasswordBody,
  DeleteMeBody,
  EmailBody,
  ExchangeBody,
  LoginBody,
  OAuthCallbackQuery,
  OAuthStartQuery,
  ProviderParams,
  RefreshBody,
  RegisterBody,
  ResetBody,
  TokenBody,
  UpdateMeBody,
} from '../routes/app-auth/schemas.js';
import * as appAuthService from '../services/appAuth.js';
import * as oauthService from '../services/appAuthOAuth.js';
import * as sessionsService from '../services/appAuthSessions.js';

export const register = async (request: FastifyRequest<{ Body: RegisterBody }>, reply: FastifyReply) => {
  const result = await appAuthService.register(request.server.appAuth, toSiteActorContext(request), {
    ...request.body,
    client: toClientInfo(request),
  });
  // 202: confirmation required, the same answer whether or not the address already had an account.
  return reply.code(result.confirmationRequired ? 202 : 201).send(result);
};

export const login = async (request: FastifyRequest<{ Body: LoginBody }>) =>
  appAuthService.login(request.server.appAuth, { ...request.body, client: toClientInfo(request) });

export const refresh = async (request: FastifyRequest<{ Body: RefreshBody }>) =>
  sessionsService.refreshSession(request.server.appAuth, request.body.refreshToken, toClientInfo(request));

export const logout = async (request: FastifyRequest<{ Body: RefreshBody }>, reply: FastifyReply) => {
  await sessionsService.revokeSession(request.body.refreshToken);
  return reply.code(204).send();
};

export const getMe = async (request: FastifyRequest) => appAuthService.getMe(request.principal);

export const updateMe = async (request: FastifyRequest<{ Body: UpdateMeBody }>) =>
  appAuthService.updateMe(request.principal, request.body);

export const changePassword = async (request: FastifyRequest<{ Body: ChangePasswordBody }>) =>
  appAuthService.changePassword(request.server.appAuth, toActorContext(request), {
    ...request.body,
    client: toClientInfo(request),
  });

export const deleteMe = async (request: FastifyRequest<{ Body: DeleteMeBody }>, reply: FastifyReply) => {
  await appAuthService.deleteMe(toActorContext(request), request.body);
  return reply.code(204).send();
};

export const confirmEmail = async (request: FastifyRequest<{ Body: TokenBody }>, reply: FastifyReply) => {
  await appAuthService.confirmEmail(toActorContext(request), request.body.token);
  return reply.code(204).send();
};

export const resendConfirmation = async (
  request: FastifyRequest<{ Body: EmailBody }>,
  reply: FastifyReply,
) => {
  await appAuthService.resendConfirmationByEmail(request.server.appAuth, request.body.email);
  return reply.code(202).send();
};

export const requestPasswordReset = async (
  request: FastifyRequest<{ Body: EmailBody }>,
  reply: FastifyReply,
) => {
  await appAuthService.requestPasswordReset(
    request.server.appAuth,
    toActorContext(request),
    request.body.email,
  );
  return reply.code(202).send();
};

export const confirmPasswordReset = async (
  request: FastifyRequest<{ Body: ResetBody }>,
  reply: FastifyReply,
) => {
  await appAuthService.confirmPasswordReset(toActorContext(request), request.body);
  return reply.code(204).send();
};

export const listProviders = async (request: FastifyRequest) => ({
  providers: request.server.appAuth.providers.enabled(),
});

/** The state cookie lives only on the OAuth paths, for the provider round trip. */
const oauthCookieOptions = (request: FastifyRequest) => ({
  path: request.server.urls.withBasePath('/api/app-auth/oauth/'),
  httpOnly: true,
  // Lax: the cookie must come back on the provider's top-level redirect to the callback.
  sameSite: 'lax' as const,
  secure: request.server.urls.publicUrl.startsWith('https:'),
});

export const startOAuth = async (
  request: FastifyRequest<{ Params: ProviderParams; Querystring: OAuthStartQuery }>,
  reply: FastifyReply,
) => {
  const start = oauthService.startOAuth(request.server.appAuth, request.params.provider, {
    redirectTo: request.query.redirectTo,
    appCodeChallenge: request.query.codeChallenge,
  });
  return reply
    .setCookie(OAUTH_STATE_COOKIE_NAME, start.stateCookie, {
      ...oauthCookieOptions(request),
      maxAge: start.cookieMaxAgeSeconds,
    })
    .redirect(start.authorizationUrl, 302);
};

export const completeOAuth = async (
  request: FastifyRequest<{ Params: ProviderParams; Querystring: OAuthCallbackQuery }>,
  reply: FastifyReply,
) => {
  const result = await oauthService.completeOAuth(request.server.appAuth, toSiteActorContext(request), {
    provider: request.params.provider,
    stateCookie: request.cookies[OAUTH_STATE_COOKIE_NAME],
    query: request.query,
  });
  return reply
    .clearCookie(OAUTH_STATE_COOKIE_NAME, oauthCookieOptions(request))
    .redirect(result.redirectUrl, 302);
};

export const exchangeOAuthCode = async (request: FastifyRequest<{ Body: ExchangeBody }>) =>
  oauthService.exchangeLoginCode(request.server.appAuth, request.body, toClientInfo(request));
