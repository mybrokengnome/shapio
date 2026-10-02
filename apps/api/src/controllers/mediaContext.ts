import type { FastifyRequest } from 'fastify';
import type { MediaServiceContext } from '../services/mediaContext.js';

/** The media service context for a request: the principal, storage, URL builder and upload limits. */
export const mediaContextFor = (request: FastifyRequest): MediaServiceContext => {
  const { server } = request;
  return {
    actor: request.principal,
    requestId: request.id,
    ip: request.ip,
    storage: server.mediaStorage,
    urls: server.urls,
    signingSecret: server.signingSecret,
    permissions: server.permissions,
    limits: {
      maxUploadBytes: server.config.storage.maxUploadBytes,
      allowedTypes: server.config.storage.allowedTypes,
    },
  };
};
