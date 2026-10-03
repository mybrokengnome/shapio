import type { FastifyRequest } from 'fastify';
import { getRequestSchema } from '../plugins/schemaSnapshot.js';
import { getRequestSite } from '../plugins/siteResolution.js';
import type { ContentServiceContext } from '../services/contentAccess.js';

/** The service context for a content request: the pinned snapshot, the principal and dependencies. */
export const contentContextFor = async (request: FastifyRequest): Promise<ContentServiceContext> => ({
  db: request.server.db,
  snapshot: await getRequestSchema(request),
  permissions: request.server.permissions,
  actor: request.principal,
  site: getRequestSite(request),
  hooks: request.server.contentHooks,
  media: { storage: request.server.mediaStorage, urls: request.server.urls },
  requestId: request.id,
  ip: request.ip,
});

/** The raw querystring (bracket syntax is parsed by the content compiler, not Fastify's flat parser). */
export const rawQueryOf = (request: FastifyRequest): string => {
  const index = request.url.indexOf('?');
  return index === -1 ? '' : request.url.slice(index + 1);
};
