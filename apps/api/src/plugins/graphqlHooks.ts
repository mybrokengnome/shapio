import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Kind, type DocumentNode, type GraphQLSchema, type OperationDefinitionNode } from 'graphql';
import { fragmentsOf } from '../schema/codegen/graphql/complexity.js';
import { operationUsage, type OperationUsage } from '../schema/codegen/graphql/usageSelection.js';
import { usagePrincipalKey } from '../usage/keys.js';
import { getRequestSite } from './siteResolution.js';

/** Route hooks of `/api/graphql` (plugins/graphql.ts). */

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
 * never stored.
 */
export const cacheHeaders = async (request: FastifyRequest, reply: FastifyReply, payload: unknown) => {
  reply.header('vary', 'Authorization, Cookie');
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

const pendingUsage = new WeakMap<FastifyRequest, { principalKey: string; usage: OperationUsage }>();

/** The operation mercurius executes: the only one, or the one named by the request's `operationName`. */
const executedOperation = (request: FastifyRequest, document: DocumentNode) => {
  const operations = document.definitions.filter(
    (definition): definition is OperationDefinitionNode => definition.kind === Kind.OPERATION_DEFINITION,
  );
  if (operations.length <= 1) {
    return operations[0];
  }
  const source = (request.method === 'GET' ? request.query : request.body) as {
    operationName?: unknown;
  } | null;
  const name = source?.operationName;
  return operations.find((operation) => operation.name?.value === name);
};

/**
 * Field usage (plan developer-face §5), step 1 (`preExecution`): what the operation selects, walked once
 * per operation. Admin users and previews are not counted (usage/keys.ts).
 */
export const collectUsage = (
  request: FastifyRequest,
  schema: GraphQLSchema,
  document: DocumentNode,
  variables: Record<string, unknown> | undefined,
) => {
  const principalKey = usagePrincipalKey(request.principal);
  const operation = executedOperation(request, document);
  if (principalKey === null || !operation) {
    return;
  }
  const usage = operationUsage(schema, operation, fragmentsOf(document.definitions), variables ?? {});
  if (usage.reads.size > 0) {
    pendingUsage.set(request, { principalKey, usage });
  }
};

/** Step 2 (`onResolution`): counts the reads once the operation returned data. */
export const recordUsage = (request: FastifyRequest, hasData: boolean) => {
  const pending = pendingUsage.get(request);
  pendingUsage.delete(request);
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
