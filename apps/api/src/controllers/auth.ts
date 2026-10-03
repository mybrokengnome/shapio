import type { FastifyReply, FastifyRequest } from 'fastify';
import { SESSION_COOKIE_NAME } from '../constants/auth.js';
import { toActorContext, toClientInfo } from '../helpers/requestContext.js';
import { getRequestSchema } from '../plugins/schemaSnapshot.js';
import { getRequestSite } from '../plugins/siteResolution.js';
import type {
  ChangePasswordBody,
  ConfirmResetBody,
  LoginBody,
  RequestResetBody,
  UpdateMeBody,
} from '../routes/admin/auth/schemas.js';
import type { IdParams } from '../routes/schemas/adminIdentity.js';
import * as adminSessionsService from '../services/adminSessions.js';
import { getAdminUser } from '../services/adminUsers.js';
import * as authService from '../services/auth.js';
import * as passwordResetsService from '../services/passwordResets.js';
import { issueCsrfToken, startSessionResponse } from './sessionResponse.js';

export const login = async (request: FastifyRequest<{ Body: LoginBody }>, reply: FastifyReply) => {
  const { adminUserId, session } = await authService.login({
    ...request.body,
    client: toClientInfo(request),
    previousSessionToken: request.cookies[SESSION_COOKIE_NAME],
    requestId: request.id,
  });
  const csrfToken = startSessionResponse(request, reply, session);
  return reply.send({ user: await getAdminUser(adminUserId), csrfToken });
};

export const logout = async (request: FastifyRequest, reply: FastifyReply) => {
  await authService.logout(toActorContext(request));
  return reply.clearSessionCookie().code(204).send();
};

export const getMe = async (request: FastifyRequest, reply: FastifyReply) => {
  const principal = authService.requireAdminPrincipal(request.principal);
  const snapshot = await getRequestSchema(request);
  const modelIds = [...snapshot.modelsByApiKey.values()].map((active) => active.definition.id);
  const me = await authService.getMe(
    principal,
    getRequestSite(request),
    request.server.permissions,
    modelIds,
  );
  return reply.send({
    ...me,
    emailDelivery: request.server.config.email.transport,
    csrfToken: reply.generateCsrf(),
  });
};

export const updateMe = async (request: FastifyRequest<{ Body: UpdateMeBody }>) =>
  authService.updateOwnProfile(toActorContext(request), request.body);

export const changePassword = async (
  request: FastifyRequest<{ Body: ChangePasswordBody }>,
  reply: FastifyReply,
) => {
  const session = await authService.changeOwnPassword(toActorContext(request), {
    ...request.body,
    client: toClientInfo(request),
  });
  return reply.send({ csrfToken: startSessionResponse(request, reply, session) });
};

export const getCsrfToken = async (request: FastifyRequest, reply: FastifyReply) =>
  reply.send({ csrfToken: issueCsrfToken(request, reply, request.session._csrf ?? '') });

export const listSessions = async (request: FastifyRequest) => {
  const principal = authService.requireAdminPrincipal(request.principal);
  const sessions = await adminSessionsService.listSessions(principal.adminUserId);
  return sessions.map((session) => ({
    id: session.id,
    current: session.id === principal.sessionId,
    ip: session.ip,
    userAgent: session.user_agent,
    createdAt: session.created_at,
    lastSeenAt: session.last_seen_at,
    expiresAt: session.expires_at,
  }));
};

export const revokeSession = async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
  const principal = authService.requireAdminPrincipal(request.principal);
  await adminSessionsService.revokeOwnSession(toActorContext(request), request.params.id);
  if (request.params.id === principal.sessionId) {
    reply.clearSessionCookie();
  }
  return reply.code(204).send();
};

export const requestPasswordReset = async (
  request: FastifyRequest<{ Body: RequestResetBody }>,
  reply: FastifyReply,
) => {
  await passwordResetsService.requestPasswordReset(toActorContext(request), request.body.email);
  return reply.code(202).send({});
};

export const confirmPasswordReset = async (
  request: FastifyRequest<{ Body: ConfirmResetBody }>,
  reply: FastifyReply,
) => {
  await passwordResetsService.confirmPasswordReset(toActorContext(request), request.body);
  return reply.code(204).send();
};
