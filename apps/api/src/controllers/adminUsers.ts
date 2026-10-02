import type { FastifyReply, FastifyRequest } from 'fastify';
import { toActorContext, toClientInfo } from '../helpers/requestContext.js';
import type {
  AcceptInvitationBody,
  CreateInvitationBody,
  InspectInvitationBody,
  UpdateUserBody,
} from '../routes/admin/users/schemas.js';
import type { IdParams } from '../routes/schemas/adminIdentity.js';
import * as adminUsersService from '../services/adminUsers.js';
import * as invitationsService from '../services/invitations.js';
import { startSessionResponse } from './sessionResponse.js';

export const listUsers = async () => adminUsersService.listAdminUsers();

export const getUser = async (request: FastifyRequest<{ Params: IdParams }>) =>
  adminUsersService.getAdminUser(request.params.id);

export const updateUser = async (request: FastifyRequest<{ Params: IdParams; Body: UpdateUserBody }>) =>
  adminUsersService.updateAdminUser(toActorContext(request), request.params.id, request.body);

export const deleteUser = async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
  await adminUsersService.deleteAdminUser(toActorContext(request), request.params.id);
  return reply.code(204).send();
};

export const revokeUserSessions = async (
  request: FastifyRequest<{ Params: IdParams }>,
  reply: FastifyReply,
) => {
  await adminUsersService.revokeAdminUserSessions(toActorContext(request), request.params.id);
  return reply.code(204).send();
};

export const listInvitations = async () => invitationsService.listInvitations();

export const createInvitation = async (
  request: FastifyRequest<{ Body: CreateInvitationBody }>,
  reply: FastifyReply,
) => reply.code(201).send(await invitationsService.createInvitation(toActorContext(request), request.body));

export const revokeInvitation = async (
  request: FastifyRequest<{ Params: IdParams }>,
  reply: FastifyReply,
) => {
  await invitationsService.revokeInvitation(toActorContext(request), request.params.id);
  return reply.code(204).send();
};

export const issueInvitationLink = async (request: FastifyRequest<{ Params: IdParams }>) =>
  invitationsService.issueInvitationLink(toActorContext(request), request.params.id, request.server.urls);

export const inspectInvitation = async (request: FastifyRequest<{ Body: InspectInvitationBody }>) =>
  invitationsService.inspectInvitation(request.body.token);

export const acceptInvitation = async (
  request: FastifyRequest<{ Body: AcceptInvitationBody }>,
  reply: FastifyReply,
) => {
  const { adminUserId, session } = await invitationsService.acceptInvitation({
    ...request.body,
    client: toClientInfo(request),
    requestId: request.id,
  });
  const csrfToken = startSessionResponse(request, reply, session);
  return reply.code(201).send({ user: await adminUsersService.getAdminUser(adminUserId), csrfToken });
};
