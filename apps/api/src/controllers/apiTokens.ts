import type { FastifyReply, FastifyRequest } from 'fastify';
import { toSiteActorContext } from '../helpers/requestContext.js';
import { getRequestPermissions } from '../plugins/requestState.js';
import type { CreateTokenBody } from '../routes/admin/tokens/schemas.js';
import type { IdParams } from '../routes/schemas/adminIdentity.js';
import * as apiTokensService from '../services/apiTokens.js';

export const listTokens = async (request: FastifyRequest) =>
  apiTokensService.listApiTokens(toSiteActorContext(request), getRequestPermissions(request));

export const createToken = async (
  request: FastifyRequest<{ Body: CreateTokenBody }>,
  reply: FastifyReply,
) => {
  const { name, roleId, expiresAt, network } = request.body;
  const created = await apiTokensService.createApiToken(
    toSiteActorContext(request),
    getRequestPermissions(request),
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
  await apiTokensService.revokeApiToken(
    toSiteActorContext(request),
    getRequestPermissions(request),
    request.params.id,
  );
  return reply.code(204).send();
};
