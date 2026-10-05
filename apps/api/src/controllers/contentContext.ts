import type { FastifyRequest } from 'fastify';
import { withoutSiteParameter } from '../helpers/siteQuery.js';
import { getRequestPermissions } from '../plugins/requestState.js';
import { getRequestNetworkSchema } from '../plugins/schemaSnapshot.js';
import { getRequestSite } from '../plugins/siteResolution.js';
import type { ContentServiceContext } from '../services/contentAccess.js';
import { buildContentContext } from '../services/contentContext.js';

/**
 * The service context for a content request: the pinned snapshot, the principal and dependencies.
 * `permissions` is the request's evaluator: checked against the versions the request read once, and
 * memoized per (principal, action, model), so the read, relation visibility, populate and usage recording
 * evaluate each model's policy once.
 */
export const contentContextFor = async (request: FastifyRequest): Promise<ContentServiceContext> =>
  buildContentContext({
    db: request.server.db,
    network: await getRequestNetworkSchema(request),
    permissions: getRequestPermissions(request),
    actor: request.principal,
    site: getRequestSite(request),
    hooks: request.server.contentHooks,
    media: { storage: request.server.mediaStorage, urls: request.server.urls },
    requestId: request.id,
    ip: request.ip,
  });

/**
 * The raw querystring (bracket syntax is parsed by the content compiler, not Fastify's flat parser), without
 * `?site=`: site resolution (plugins/siteResolution.ts) consumed it, and the compiler refuses unknown keys.
 */
export const rawQueryOf = (request: FastifyRequest): string => {
  const index = request.url.indexOf('?');
  if (index === -1) {
    return '';
  }
  return withoutSiteParameter(request.url.slice(index + 1));
};
