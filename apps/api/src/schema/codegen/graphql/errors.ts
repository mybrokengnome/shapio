import type { FastifyBaseLogger } from 'fastify';
import { GraphQLError, type ExecutionResult, type GraphQLFormattedError } from 'graphql';
import { AppError } from '../../../helpers/appError.js';

/**
 * GraphQL error responses: every error carries `extensions.code`, the same machine-readable codes as REST
 * (`FORBIDDEN_FIELD`, `INVALID_QUERY`, `CONTENT_VERSION_CONFLICT`…), plus `details` where REST has them.
 * Unexpected failures are logged and reported as INTERNAL_ERROR without their text (as REST does).
 */
const CSRF_ERROR_CODES: ReadonlySet<string> = new Set(['FST_CSRF_INVALID_TOKEN', 'FST_CSRF_MISSING_SECRET']);

type ErrorWithStatus = Error & { statusCode?: number; code?: string; validation?: unknown };

type Classified = { formatted: GraphQLFormattedError; statusCode: number };

const withExtensions = (
  error: GraphQLError,
  message: string,
  extensions: Record<string, unknown>,
): GraphQLFormattedError => {
  const formatted = error.toJSON();
  return { ...formatted, message, extensions: { ...formatted.extensions, ...extensions } };
};

const classify = (error: GraphQLError, log: FastifyBaseLogger): Classified => {
  const original: ErrorWithStatus | undefined = error.originalError;
  if (original instanceof AppError) {
    return {
      formatted: withExtensions(error, original.message, {
        code: original.code,
        ...(original.details !== undefined ? { details: original.details } : {}),
      }),
      statusCode: original.statusCode,
    };
  }
  if (original?.code !== undefined && CSRF_ERROR_CODES.has(original.code)) {
    return {
      formatted: withExtensions(error, 'Missing or invalid CSRF token', { code: 'CSRF_INVALID' }),
      statusCode: 403,
    };
  }
  if (original?.validation !== undefined) {
    return {
      formatted: withExtensions(error, original.message, { code: 'VALIDATION_ERROR' }),
      statusCode: 400,
    };
  }
  if (!original || original instanceof GraphQLError) {
    const code = typeof error.extensions.code === 'string' ? error.extensions.code : undefined;
    return {
      formatted: withExtensions(error, error.message, { code: code ?? 'GRAPHQL_VALIDATION_FAILED' }),
      statusCode: 400,
    };
  }
  const statusCode = original.statusCode ?? 500;
  if (statusCode >= 500) {
    log.error({ err: original, path: error.path }, 'GraphQL resolver failed');
    return {
      formatted: withExtensions(error, 'Internal server error', { code: 'INTERNAL_ERROR' }),
      statusCode: 500,
    };
  }
  return {
    formatted: withExtensions(error, original.message, { code: original.code ?? 'BAD_REQUEST' }),
    statusCode,
  };
};

export type GraphqlResponseBody = {
  data?: ExecutionResult['data'] | null;
  errors?: GraphQLFormattedError[];
};

export type FormattedResult = { statusCode: number; body: GraphqlResponseBody };

type FormatOptions = {
  log: FastifyBaseLogger;
  /** Callers who may not introspect get no "Did you mean …?" hints naming schema members. */
  hideSuggestions?: boolean;
};

/** graphql-js validation messages end with "Did you mean …?" suggestions, which name schema members. */
const SUGGESTION = /\s*Did you mean .*\?$/s;

/**
 * The GraphQL-over-HTTP response of one request. With data (errors in resolvers) the status is 200; without
 * data (rejected before execution: parse, validation, credentials, CSRF) it is the first error's status.
 */
export const formatGraphqlResult = (
  result: ExecutionResult,
  { log, hideSuggestions = false }: FormatOptions,
): FormattedResult => {
  if (!result.errors?.length) {
    return { statusCode: 200, body: { data: result.data ?? null } };
  }
  const classified = result.errors.map((error) => {
    const item = classify(error, log);
    return hideSuggestions
      ? { ...item, formatted: { ...item.formatted, message: item.formatted.message.replace(SUGGESTION, '') } }
      : item;
  });
  const statusCode = result.data ? 200 : (classified[0]?.statusCode ?? 400);
  if (statusCode < 500) {
    log.info(
      { statusCode, codes: classified.map((item) => item.formatted.extensions?.code) },
      'GraphQL request had errors',
    );
  }
  return {
    statusCode,
    body: { data: result.data ?? null, errors: classified.map((item) => item.formatted) },
  };
};

/**
 * A request rejected before or outside execution (credentials, CSRF, site resolution, rate limits, request
 * validation, 405), in the same envelope: `{ data: null, errors: [{ message, extensions: { code } }] }`.
 */
export const formatGraphqlRequestError = (error: unknown, log: FastifyBaseLogger): FormattedResult => {
  const original = error instanceof Error ? error : new Error(String(error));
  const graphqlError =
    original instanceof GraphQLError
      ? original
      : new GraphQLError(original.message, { originalError: original });
  return formatGraphqlResult({ errors: [graphqlError] }, { log });
};
