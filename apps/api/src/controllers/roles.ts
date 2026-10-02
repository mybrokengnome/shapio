import type { FastifyReply, FastifyRequest } from 'fastify';
import { toActorContext } from '../helpers/requestContext.js';
import type { CreateRoleBody, UpdateRoleBody } from '../routes/admin/roles/schemas.js';
import type { IdParams } from '../routes/schemas/adminIdentity.js';
import * as rolesService from '../services/roles.js';

export const listRoles = async () => rolesService.listRoles();

export const getRole = async (request: FastifyRequest<{ Params: IdParams }>) =>
  rolesService.getRole(request.params.id);

export const createRole = async (request: FastifyRequest<{ Body: CreateRoleBody }>, reply: FastifyReply) => {
  const { description = '', kind = 'admin', ...rest } = request.body;
  const role = await rolesService.createRole(
    toActorContext(request),
    { ...rest, description, kind },
    request.server.schemaLookup,
  );
  return reply.code(201).send(role);
};

export const updateRole = async (request: FastifyRequest<{ Params: IdParams; Body: UpdateRoleBody }>) =>
  rolesService.updateRole(
    toActorContext(request),
    request.params.id,
    request.body,
    request.server.schemaLookup,
  );

export const deleteRole = async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
  await rolesService.deleteRole(toActorContext(request), request.params.id);
  return reply.code(204).send();
};
