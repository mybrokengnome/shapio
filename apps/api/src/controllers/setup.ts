import type { FastifyReply, FastifyRequest } from 'fastify';
import { toClientInfo } from '../helpers/requestContext.js';
import type { CompleteSetupBody } from '../routes/admin/setup/schemas.js';
import { getAdminUser } from '../services/adminUsers.js';
import * as setupService from '../services/setup.js';
import { startSessionResponse } from './sessionResponse.js';

export const getSetupStatus = async (request: FastifyRequest) => ({
  required: await setupService.isSetupRequired(),
  requiresToken: request.server.config.setup.requireToken,
});

export const completeSetup = async (
  request: FastifyRequest<{ Body: CompleteSetupBody }>,
  reply: FastifyReply,
) => {
  const { adminUserId, session } = await setupService.completeSetup({
    ...request.body,
    token: request.body.token,
    requireToken: request.server.config.setup.requireToken,
    client: toClientInfo(request),
    requestId: request.id,
  });
  const csrfToken = startSessionResponse(request, reply, session);
  return reply.code(201).send({ user: await getAdminUser(adminUserId), csrfToken });
};
