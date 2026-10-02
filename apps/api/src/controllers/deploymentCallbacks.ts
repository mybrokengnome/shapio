import type { FastifyRequest } from 'fastify';
import { handleDeploymentCallback, type CallbackBody } from '../deployments/callbacks.js';
import { SIGNATURE_HEADER, TIMESTAMP_HEADER } from '../publishing/signature.js';

const header = (request: FastifyRequest, name: string) => {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
};

export const receiveCallback = async (
  request: FastifyRequest<{ Params: { connectionId: string }; Body: CallbackBody }>,
) =>
  handleDeploymentCallback(request.server.publishing, request.params.connectionId, {
    rawBody: request.rawBody ?? '',
    body: request.body,
    signature: header(request, SIGNATURE_HEADER),
    timestamp: header(request, TIMESTAMP_HEADER),
  });
