import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { DocumentNode, GraphQLSchema, OperationDefinitionNode } from 'graphql';
import { DELIVERY_VARY, DRAFTS_CACHE_CONTROL } from '../constants/sites.js';
import { appendVary } from '../helpers/vary.js';
import { fragmentsOf } from '../schema/codegen/graphql/complexity.js';
import { lensUsage } from '../schema/codegen/graphql/lensUsage.js';
import { operationUsage, type OperationUsage } from '../schema/codegen/graphql/usageSelection.js';
import type { SchemaVisibility } from '../schema/codegen/graphql/visibility.js';
import type { RequestLens } from '../schema/lens/views.js';
import type { SchemaSnapshot } from '../schema/snapshot.js';
import { usagePrincipalKey } from '../usage/keys.js';
import { getRequestSite } from './siteResolution.js';

/** Route hooks and usage counting of `/api/graphql` (routes/graphql, controllers/graphql.ts). */

/**
 * Cookie sessions need the CSRF header on every GraphQL request (ADR 0005). POSTs are already checked by
 * plugins/csrf.ts; this checks GET queries too.
 */
export const csrfForGet =
  (app: FastifyInstance) => (request: FastifyRequest, reply: FastifyReply, done: (error?: Error) => void) => {
    if (request.method === 'GET' && request.authMethod === 'session') {
      app.csrfProtection(request, reply, done);
      return;
    }
    done();
  };

/**
 * Responses vary by credentials. GET queries get REST's validators (a strong ETag over the body, 304 on a
 * match) and its caching policy (public for anonymous callers, private otherwise); everything else is
 * never stored. An operation that read drafts (the controller set `DRAFTS_CACHE_CONTROL`) keeps it.
 */
export const cacheHeaders = async (request: FastifyRequest, reply: FastifyReply, payload: unknown) => {
  appendVary(reply, DELIVERY_VARY);
  if (reply.getHeader('cache-control') === DRAFTS_CACHE_CONTROL) {
    return payload;
  }
  if (request.method !== 'GET' || reply.statusCode !== 200 || typeof payload !== 'string') {
    reply.header('cache-control', 'no-store');
    return payload;
  }
  const etag = `"${createHash('sha256').update(payload).digest('base64url').slice(0, 32)}"`;
  reply.header('etag', etag);
  reply.header(
    'cache-control',
    request.principal.kind === 'anonymous'
      ? 'public, max-age=0, must-revalidate'
      : 'private, max-age=0, must-revalidate',
  );
  const match = request.headers['if-none-match'];
  if (typeof match === 'string' && match.split(',').some((candidate) => candidate.trim() === etag)) {
    reply.code(304);
    return '';
  }
  return payload;
};

/** What one operation reads, counted once it resolves with data. */
export type PendingUsage = { principalKey: string; usage: OperationUsage };

/** An operation run through a schema lens: its lens, today's view and the caller's visibility there. */
export type UsageLens = { lens: RequestLens; current: SchemaSnapshot; visibility: SchemaVisibility };

/**
 * Field usage (plan developer-face §5), step 1 (before execution): what the executed operation selects,
 * walked once per operation. Admin users and previews are not counted (usage/keys.ts). Through a schema lens,
 * reads count under today's fields, never fields that read null because they are gone or hidden today.
 */
export const collectUsage = (
  request: FastifyRequest,
  schema: GraphQLSchema,
  document: DocumentNode,
  operation: OperationDefinitionNode,
  variables: Record<string, unknown> | undefined,
  through?: UsageLens,
): PendingUsage | undefined => {
  const principalKey = usagePrincipalKey(request.principal);
  if (principalKey === null) {
    return undefined;
  }
  const selected = operationUsage(schema, operation, fragmentsOf(document.definitions), variables ?? {});
  const usage = through ? lensUsage(selected, through.lens, through.current, through.visibility) : selected;
  return usage.reads.size > 0 ? { principalKey, usage } : undefined;
};

/** Step 2 (after execution): counts the reads once the operation returned data. */
export const recordUsage = (request: FastifyRequest, pending: PendingUsage | undefined, hasData: boolean) => {
  if (!pending || !hasData) {
    return;
  }
  const { principalKey, usage } = pending;
  const site = getRequestSite(request);
  request.server.usage.recordRequest(site.id, principalKey, usage.snapshot);
  for (const [modelId, reads] of usage.reads) {
    request.server.usage.recordFieldReads(site.id, principalKey, modelId, reads);
  }
};
