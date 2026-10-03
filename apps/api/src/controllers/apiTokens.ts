import type { FastifyReply, FastifyRequest } from 'fastify';
import { toActorContext, toSiteActorContext } from '../helpers/requestContext.js';
import type { CreateTokenBody } from '../routes/admin/tokens/schemas.js';
import type { IdParams } from '../routes/schemas/adminIdentity.js';
import * as apiTokensService from '../services/apiTokens.js';

export const listTokens = async () => apiTokensService.listApiTokens();

export const createToken = async (
  request: FastifyRequest<{ Body: CreateTokenBody }>,
  reply: FastifyReply,
) => {
  const { name, roleId, expiresAt, network } = request.body;
  const created = await apiTokensService.createApiToken(
    toSiteActorContext(request),
    request.server.permissions,
    {
      name,
      roleId,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      network,
    },
  );
  return reply.code(201).send(created);
};

export const revokeToken = async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
  await apiTokensService.revokeApiToken(toActorContext(request), request.params.id);
  return reply.code(204).send();
};
