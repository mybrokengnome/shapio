import type { FastifyReply, FastifyRequest } from 'fastify';
import { toActorContext } from '../helpers/requestContext.js';
import type { CreateTokenBody } from '../routes/admin/tokens/schemas.js';
import type { IdParams } from '../routes/schemas/adminIdentity.js';
import * as apiTokensService from '../services/apiTokens.js';

export const listTokens = async () => apiTokensService.listApiTokens();

export const createToken = async (
  request: FastifyRequest<{ Body: CreateTokenBody }>,
  reply: FastifyReply,
) => {
  const { name, roleId, expiresAt } = request.body;
  const created = await apiTokensService.createApiToken(toActorContext(request), {
    name,
    roleId,
    expiresAt: expiresAt ? new Date(expiresAt) : null,
  });
  return reply.code(201).send(created);
};

export const revokeToken = async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
  await apiTokensService.revokeApiToken(toActorContext(request), request.params.id);
  return reply.code(204).send();
};
