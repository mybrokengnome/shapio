import type { FastifyBaseLogger, FastifyRequest } from 'fastify';
import { GraphQLError, type ExecutionResult, type GraphQLFormattedError } from 'graphql';
import { AppError } from '../../../helpers/appError.js';

/**
 * GraphQL error responses: every error carries `extensions.code`, the same machine-readable codes as REST
 * (`FORBIDDEN_FIELD`, `INVALID_QUERY`, `CONTENT_VERSION_CONFLICT`…), plus `details` where REST has them.
 * Unexpected failures are logged and reported as INTERNAL_ERROR without their text (as REST does).
 */
const CSRF_ERROR_CODES: ReadonlySet<string> = new Set(['FST_CSRF_INVALID_TOKEN', 'FST_CSRF_MISSING_SECRET']);

type ErrorWithStatus = Error & { statusCode?: number; code?: string; errors?: unknown };

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

/** Mercurius wraps request-level failures (parse/validation) in one error that lists the real ones. */
const expand = (errors: readonly GraphQLError[]): GraphQLError[] =>
  errors.flatMap((error) => {
    const outer: ErrorWithStatus | undefined = error.originalError;
    const inner: unknown = outer?.errors;
    if (!outer || !Array.isArray(inner)) {
      return [error];
    }
    return inner.map((item: unknown) => {
      if (item instanceof GraphQLError) {
        return item;
      }
      // Plain errors take the wrapper's status (e.g. 405 for a mutation sent with GET).
      const originalError = Object.assign(new Error((item as Error).message), {
        statusCode: outer.statusCode,
        code: outer.code,
      });
      return new GraphQLError(originalError.message, { originalError });
    });
  });

export type FormattedExecution = {
  statusCode: number;
  response: { data: ExecutionResult['data'] | null; errors: GraphQLFormattedError[] };
};

/**
 * Mercurius `errorFormatter`. With data (errors in resolvers) the status is 200, as GraphQL-over-HTTP
 * expects; without data (rejected before execution: CSRF, credentials, validation) it is the error's status.
 */
export type FormatterContext = { reply?: { log: FastifyBaseLogger; request: FastifyRequest } };

/** graphql-js validation messages end with "Did you mean …?" suggestions, which name schema members. */
const SUGGESTION = /\s*Did you mean .*\?$/s;

export const createErrorFormatter =
  (
    log: FastifyBaseLogger,
    options: { hideSuggestions?: (context: FormatterContext | undefined) => boolean } = {},
  ) =>
  (execution: ExecutionResult & { statusCode?: number }, context?: FormatterContext): FormattedExecution => {
    const logger = context?.reply?.log ?? log;
    const hide = options.hideSuggestions?.(context) ?? false;
    const classified = expand(execution.errors ?? []).map((error) => {
      const result = classify(error, logger);
      return hide
        ? {
            ...result,
            formatted: { ...result.formatted, message: result.formatted.message.replace(SUGGESTION, '') },
          }
        : result;
    });
    const statusCode = execution.data ? 200 : (classified[0]?.statusCode ?? 200);
    if (statusCode < 500 && classified.length > 0) {
      logger.info(
        { statusCode, codes: classified.map((item) => item.formatted.extensions?.code) },
        'GraphQL request had errors',
      );
    }
    return {
      statusCode,
      response: { data: execution.data ?? null, errors: classified.map((item) => item.formatted) },
    };
  };
