import { findInvalidText, INVALID_TEXT_MESSAGE } from '@shapio/schema';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { getOperationAST, OperationTypeNode, type DocumentNode } from 'graphql';
import { DRAFTS_CACHE_CONTROL } from '../constants/sites.js';
import { AppError } from '../helpers/appError.js';
import { collectUsage, recordUsage } from '../plugins/graphqlHooks.js';
import { getRequestPermissions } from '../plugins/requestState.js';
import { getRequestSchema } from '../plugins/schemaSnapshot.js';
import { getRequestSite } from '../plugins/siteResolution.js';
import {
  formatGraphqlRequestError,
  formatGraphqlResult,
  type FormattedResult,
} from '../schema/codegen/graphql/errors.js';
import { hasNoContentAccess, resolveSchemaVisibility } from '../schema/codegen/graphql/visibility.js';
import { lensBudgetKeyOf, takeLensBuildBudget } from '../schema/lens/budget.js';
import {
  executeOperation,
  prepareOperation,
  type GraphqlOperationInput,
} from '../services/graphqlExecution.js';
import { createGraphqlRequestContext } from './graphqlContext.js';
import {
  graphqlLensOf,
  graphqlSchemaFor,
  unavailableDefinitionError,
  usageLensOf,
  withSchemaVersion,
} from './graphqlLens.js';

export type GraphqlQuerystring = { query: string; variables?: string; operationName?: string };

const introspectionDisabled = () =>
  new AppError(
    403,
    'INTROSPECTION_DISABLED',
    'Schema introspection needs an admin session or an API token (or GRAPHQL_PUBLIC_INTROSPECTION=true)',
  );

/**
 * A caller allowed no model at all gets the answer REST gives (sign-in signal for app clients) rather than a
 * validation error from its empty schema: anonymous queries 401, anything else 403. Nothing is named either way.
 */
const noContentAccess = (anonymous: boolean, document: DocumentNode, operationName?: string | null) =>
  anonymous && getOperationAST(document, operationName ?? undefined)?.operation !== OperationTypeNode.MUTATION
    ? new AppError(401, 'UNAUTHENTICATED', 'This content needs a delivery token')
    : new AppError(403, 'FORBIDDEN', 'Your credentials may not read or write any content here');

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
  // Decoded from JSON escapes here, after the request-level text check (plugins/textInput.ts).
  const path = findInvalidText(parsed, '/query/variables');
  if (path !== undefined) {
    throw new AppError(422, 'INVALID_TEXT', `Text ${INVALID_TEXT_MESSAGE}`, { path });
  }
  return parsed as Record<string, unknown>;
};

/**
 * The caller's lens build budget (plan schema-lenses): a lens GraphQL schema not cached yet is built only while
 * the caller's bucket of cache-miss builds lasts (429 beyond it); undefined for work that is never limited.
 */
const lensBuildAdmission = (request: FastifyRequest): (() => boolean) | undefined => {
  const key = lensBudgetKeyOf(request.principal, getRequestSite(request).id, request.ip);
  return key === null ? undefined : () => takeLensBuildBudget(key);
};

const runGraphql = async (request: FastifyRequest, reply: FastifyReply, input: GraphqlOperationInput) => {
  const runtime = request.server.graphqlRuntime;
  const mayIntrospect = runtime.mayIntrospect(request.principal);
  const view = await getRequestSchema(request);
  // The schema as this caller may see it: a delivery caller's never names a field or model it cannot read.
  const visibility = await resolveSchemaVisibility(view, getRequestPermissions(request), request.principal);
  // A request naming a schema version reads in that version's shape (plan schema-lenses). A caller allowed no
  // content gets exactly the answer it gets without a version, whatever version it names (one that cannot be
  // read included): no lens is loaded or built for it, and no version error answers it.
  const authorized = !hasNoContentAccess(visibility);
  if (authorized && request.schemaVersionError) {
    throw request.schemaVersionError;
  }
  const lensed = await graphqlLensOf(request, view, authorized);
  const { schema } = await graphqlSchemaFor(runtime, view, visibility, lensed, lensBuildAdmission(request));
  const prepared = prepareOperation(schema, input, runtime);
  if (!prepared.ok) {
    const unavailable =
      prepared.document &&
      unavailableDefinitionError(lensed, visibility, prepared.document, input.operationName);
    if (unavailable) {
      throw unavailable;
    }
    if (prepared.document && hasNoContentAccess(visibility)) {
      throw noContentAccess(request.principal.kind === 'anonymous', prepared.document, input.operationName);
    }
    return send(
      reply,
      withSchemaVersion(
        formatGraphqlResult(
          { errors: prepared.errors },
          { log: request.log, hideSuggestions: !mayIntrospect },
        ),
        lensed,
      ),
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
    usageLensOf(lensed, visibility),
  );
  const context = createGraphqlRequestContext(request, lensed);
  const result = await executeOperation(schema, prepared, input, context);
  recordUsage(
    request,
    usage,
    result.data !== null && result.data !== undefined,
    lensed?.lens?.requested ?? null,
  );
  if (context.readDrafts()) {
    // Drafts (plan drafts-mode §3) are never stored by a cache, as REST draft reads.
    reply.header('cache-control', DRAFTS_CACHE_CONTROL);
  }
  return send(reply, withSchemaVersion(formatGraphqlResult(result, { log: request.log }), lensed));
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
