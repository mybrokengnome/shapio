import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { OperationTypeNode } from 'graphql';
import { DRAFTS_CACHE_CONTROL } from '../constants/sites.js';
import { AppError } from '../helpers/appError.js';
import { collectUsage, recordUsage } from '../plugins/graphqlHooks.js';
import { getRequestSchema } from '../plugins/schemaSnapshot.js';
import {
  formatGraphqlRequestError,
  formatGraphqlResult,
  type FormattedResult,
} from '../schema/codegen/graphql/errors.js';
import {
  executeOperation,
  prepareOperation,
  type GraphqlOperationInput,
} from '../services/graphqlExecution.js';
import { createGraphqlRequestContext } from './graphqlContext.js';

export type GraphqlQuerystring = { query: string; variables?: string; operationName?: string };

const introspectionDisabled = () =>
  new AppError(
    403,
    'INTROSPECTION_DISABLED',
    'Schema introspection needs an admin session or an API token (or GRAPHQL_PUBLIC_INTROSPECTION=true)',
  );

const mutationOverGet = () =>
  new AppError(405, 'METHOD_NOT_ALLOWED', 'Only queries may be sent with GET; send mutations with POST');

const send = (reply: FastifyReply, { statusCode, body }: FormattedResult) =>
  reply.code(statusCode).send(body);

/** GET carries variables as a JSON object in the query string. */
const variablesOf = (raw: string | undefined): Record<string, unknown> | undefined => {
  if (raw === undefined || raw === '') {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = undefined;
  }
  if (parsed === null) {
    return undefined;
  }
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AppError(400, 'BAD_REQUEST', '`variables` must be a JSON object');
  }
  return parsed as Record<string, unknown>;
};

const runGraphql = async (request: FastifyRequest, reply: FastifyReply, input: GraphqlOperationInput) => {
  const runtime = request.server.graphqlRuntime;
  const mayIntrospect = runtime.mayIntrospect(request.principal);
  const { schema } = await runtime.schemas.get(await getRequestSchema(request));
  const prepared = prepareOperation(schema, input, runtime);
  if (!prepared.ok) {
    return send(
      reply,
      formatGraphqlResult({ errors: prepared.errors }, { log: request.log, hideSuggestions: !mayIntrospect }),
    );
  }
  if (request.method === 'GET' && prepared.operation.operation !== OperationTypeNode.QUERY) {
    reply.header('allow', 'POST');
    throw mutationOverGet();
  }
  if (prepared.selectsIntrospection && !mayIntrospect) {
    throw introspectionDisabled();
  }
  const usage = collectUsage(
    request,
    schema,
    prepared.document,
    prepared.operation,
    input.variables ?? undefined,
  );
  const context = createGraphqlRequestContext(request);
  const result = await executeOperation(schema, prepared, input, context);
  recordUsage(request, usage, result.data !== null && result.data !== undefined);
  if (context.readDrafts()) {
    // Drafts (plan drafts-mode §3) are never stored by a cache, as REST draft reads.
    reply.header('cache-control', DRAFTS_CACHE_CONTROL);
  }
  return send(reply, formatGraphqlResult(result, { log: request.log }));
};

export const postGraphql = async (
  request: FastifyRequest<{ Body: GraphqlOperationInput }>,
  reply: FastifyReply,
) => runGraphql(request, reply, request.body);

export const getGraphql = async (
  request: FastifyRequest<{ Querystring: GraphqlQuerystring }>,
  reply: FastifyReply,
) => {
  const { query, variables, operationName } = request.query;
  return runGraphql(request, reply, { query, variables: variablesOf(variables), operationName });
};

/**
 * The GraphQL-over-HTTP envelope for errors raised anywhere in an `/api/graphql` request (credentials, CSRF,
 * site resolution, rate limits, request validation, 405, 403 introspection): `{ data: null, errors }` with
 * the error's status, the shape GraphQL clients read. Every other route uses the central handler
 * (plugins/errorHandler.ts).
 */
export const graphqlErrorHandler = (error: FastifyError, request: FastifyRequest, reply: FastifyReply) =>
  // Logs unexpected (5xx) errors with their detail and answers without it.
  send(reply, formatGraphqlRequestError(error, request.log));
