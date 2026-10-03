import type { FastifyRequest } from 'fastify';
import { toSiteActorContext } from '../helpers/requestContext.js';
import type { MediaServiceContext } from '../services/mediaContext.js';

/** The media service context for a request: the principal, storage, URL builder and upload limits. */
export const mediaContextFor = (request: FastifyRequest): MediaServiceContext => {
  const { server } = request;
  return {
    ...toSiteActorContext(request),
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
