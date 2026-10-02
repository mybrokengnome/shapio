import type { FastifyReply, FastifyRequest } from 'fastify';
import { toActorContext } from '../helpers/requestContext.js';
import type { ListAppUsersQuery, UpdateAppUserBody } from '../routes/admin/appUsers/schemas.js';
import type { IdParams } from '../routes/schemas/adminIdentity.js';
import * as appUsersService from '../services/appUsers.js';

const DEFAULT_PAGE_SIZE = 50;

export const listAppUsers = async (request: FastifyRequest<{ Querystring: ListAppUsersQuery }>) =>
  appUsersService.listAppUsers({
    ...(request.query.search !== undefined ? { search: request.query.search } : {}),
    ...(request.query.cursor !== undefined ? { cursor: request.query.cursor } : {}),
    limit: request.query.limit ?? DEFAULT_PAGE_SIZE,
  });

export const getAppUser = async (request: FastifyRequest<{ Params: IdParams }>) =>
  appUsersService.getAppUser(request.params.id);

export const updateAppUser = async (request: FastifyRequest<{ Params: IdParams; Body: UpdateAppUserBody }>) =>
  appUsersService.updateAppUser(toActorContext(request), request.params.id, request.body);

export const deleteAppUser = async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
  await appUsersService.deleteAppUser(toActorContext(request), request.params.id);
  return reply.code(204).send();
};

export const resendConfirmation = async (
  request: FastifyRequest<{ Params: IdParams }>,
  reply: FastifyReply,
) => {
  await appUsersService.resendConfirmation(
    toActorContext(request),
    request.server.appAuth.config,
    request.params.id,
  );
  return reply.code(202).send();
};
