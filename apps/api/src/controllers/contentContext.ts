import type { FastifyRequest } from 'fastify';
import { schemaVersionToken } from '../constants/schemaLens.js';
import { withoutSchemaVersionParameter } from '../helpers/schemaVersionQuery.js';
import { withoutSiteParameter } from '../helpers/siteQuery.js';
import { getRequestPermissions } from '../plugins/requestState.js';
import { getRequestNetworkSchema } from '../plugins/schemaSnapshot.js';
import { getRequestSite } from '../plugins/siteResolution.js';
import { withSchemaLens, type ContentServiceContext } from '../services/contentAccess.js';
import { buildContentContext } from '../services/contentContext.js';

/**
 * The service context for a content request: the pinned snapshot, the principal and dependencies.
 * `permissions` is the request's evaluator: checked against the versions the request read once, and
 * memoized per (principal, action, model), so the read, relation visibility, populate and usage recording
 * evaluate each model's policy once.
 */
export const contentContextFor = async (request: FastifyRequest): Promise<ContentServiceContext> => {
  const context = buildContentContext({
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
  if (!request.schemaLensRoute) {
    return context;
  }
  // Delivery, preview and snapshot reads: the schema version the request names, and the current one's token
  // on the response (plugins/schemaLens.ts).
  const lensed = await withSchemaLens(context, request.schemaVersionToken);
  request.schemaVersionCurrent = schemaVersionToken(lensed.schemaId as string, context.snapshot.version);
  return lensed;
};

/**
 * The raw querystring (bracket syntax is parsed by the content compiler, not Fastify's flat parser), without
 * `?site=` and `?schemaVersion=`: site resolution and the schema lens plugin consumed them, and the compiler
 * refuses unknown keys.
 */
export const rawQueryOf = (request: FastifyRequest): string => {
  const index = request.url.indexOf('?');
  if (index === -1) {
    return '';
  }
  return withoutSchemaVersionParameter(withoutSiteParameter(request.url.slice(index + 1)));
};
