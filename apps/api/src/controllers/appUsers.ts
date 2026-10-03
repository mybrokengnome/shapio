import type { FastifyReply, FastifyRequest } from 'fastify';
import { toSiteActorContext } from '../helpers/requestContext.js';
import { getRequestSite } from '../plugins/siteResolution.js';
import type { ListAppUsersQuery, UpdateAppUserBody } from '../routes/admin/appUsers/schemas.js';
import type { IdParams } from '../routes/schemas/adminIdentity.js';
import * as appUsersService from '../services/appUsers.js';

const DEFAULT_PAGE_SIZE = 50;

export const listAppUsers = async (request: FastifyRequest<{ Querystring: ListAppUsersQuery }>) =>
  appUsersService.listAppUsers(getRequestSite(request), {
    ...(request.query.search !== undefined ? { search: request.query.search } : {}),
    ...(request.query.cursor !== undefined ? { cursor: request.query.cursor } : {}),
    limit: request.query.limit ?? DEFAULT_PAGE_SIZE,
  });

export const getAppUser = async (request: FastifyRequest<{ Params: IdParams }>) =>
  appUsersService.getAppUser(getRequestSite(request), request.params.id);

export const updateAppUser = async (request: FastifyRequest<{ Params: IdParams; Body: UpdateAppUserBody }>) =>
  appUsersService.updateAppUser(toSiteActorContext(request), request.params.id, request.body);

export const deleteAppUser = async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
  await appUsersService.deleteAppUser(toSiteActorContext(request), request.params.id);
  return reply.code(204).send();
};

export const resendConfirmation = async (
  request: FastifyRequest<{ Params: IdParams }>,
  reply: FastifyReply,
) => {
  await appUsersService.resendConfirmation(
    toSiteActorContext(request),
    request.server.appAuth.config,
    request.params.id,
  );
  return reply.code(202).send();
};
