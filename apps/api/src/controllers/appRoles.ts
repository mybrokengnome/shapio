import type { FastifyReply, FastifyRequest } from 'fastify';
import { toActorContext } from '../helpers/requestContext.js';
import type { CreateAppRoleBody, UpdateAppRoleBody } from '../routes/admin/appRoles/schemas.js';
import type { IdParams } from '../routes/schemas/adminIdentity.js';
import * as appRolesService from '../services/appRoles.js';

export const listAppRoles = async () => appRolesService.listAppRoles();

export const getAppRole = async (request: FastifyRequest<{ Params: IdParams }>) =>
  appRolesService.getAppRole(request.params.id);

export const createAppRole = async (
  request: FastifyRequest<{ Body: CreateAppRoleBody }>,
  reply: FastifyReply,
) => {
  const { description = '', ...rest } = request.body;
  const role = await appRolesService.createAppRole(
    toActorContext(request),
    { ...rest, description },
    request.server.schemaLookup,
  );
  return reply.code(201).send(role);
};

export const updateAppRole = async (request: FastifyRequest<{ Params: IdParams; Body: UpdateAppRoleBody }>) =>
  appRolesService.updateAppRole(
    toActorContext(request),
    request.params.id,
    request.body,
    request.server.schemaLookup,
  );

export const deleteAppRole = async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
  await appRolesService.deleteAppRole(toActorContext(request), request.params.id);
  return reply.code(204).send();
};
