import type { FastifyRequest } from 'fastify';
import { toActorContext } from '../helpers/requestContext.js';
import type { UpdateNetworkApprovalBody } from '../routes/admin/network/schemas.js';
import * as networkApprovalService from '../services/networkApproval.js';

const contextFor = (request: FastifyRequest): networkApprovalService.NetworkApprovalContext => ({
  ...toActorContext(request),
  db: request.server.db,
});

export const getNetworkApproval = async (request: FastifyRequest) =>
  networkApprovalService.getNetworkApproval(contextFor(request));

export const updateNetworkApproval = async (request: FastifyRequest<{ Body: UpdateNetworkApprovalBody }>) =>
  networkApprovalService.updateNetworkApproval(contextFor(request), request.body);
