import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { AppError } from '../helpers/appError.js';
import type { ErrorResponse } from '../routes/schemas/error.js';

const STATUS_CODES: Readonly<Record<number, string>> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  406: 'NOT_ACCEPTABLE',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'RATE_LIMITED',
  503: 'SERVICE_UNAVAILABLE',
};

/** Errors raised by @fastify/csrf-protection (plugins/csrf.ts). */
const CSRF_ERROR_CODES: ReadonlySet<string> = new Set(['FST_CSRF_INVALID_TOKEN', 'FST_CSRF_MISSING_SECRET']);

const toErrorResponse = (error: FastifyError | AppError): { statusCode: number; body: ErrorResponse } => {
  if (error instanceof AppError) {
    const body: ErrorResponse = { error: { code: error.code, message: error.message } };
    if (error.details !== undefined) {
      body.error.details = error.details;
    }
    return { statusCode: error.statusCode, body };
  }
  if (CSRF_ERROR_CODES.has(error.code)) {
    // Its own code, so clients know to fetch a fresh token (GET /api/admin/auth/csrf) and retry.
    return {
      statusCode: 403,
      body: { error: { code: 'CSRF_INVALID', message: 'Missing or invalid CSRF token' } },
    };
  }
  if (error.validation) {
    return {
      statusCode: 400,
      body: {
        error: {
          code: 'VALIDATION_ERROR',
          message: error.message,
          details: error.validation.map(({ instancePath, message, params }) => ({
            instancePath,
            message,
            params,
          })),
        },
      },
    };
  }
  const statusCode = error.statusCode !== undefined && error.statusCode >= 400 ? error.statusCode : 500;
  if (statusCode >= 500) {
    // Never echo internal error text to clients.
    return { statusCode, body: { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } } };
  }
  return {
    statusCode,
    body: { error: { code: STATUS_CODES[statusCode] ?? 'ERROR', message: error.message } },
  };
};

/** The single error handler: consistent `{ error: { code, message, details? } }` bodies and logging. */
export const errorHandlerPlugin = fp(
  async (app: FastifyInstance) => {
    app.setErrorHandler((error: FastifyError | AppError, request: FastifyRequest, reply: FastifyReply) => {
      const { statusCode, body } = toErrorResponse(error);
      if (statusCode >= 500) {
        request.log.error({ err: error }, 'request failed');
      } else {
        request.log.info({ statusCode, code: body.error.code }, 'request rejected');
      }
      return reply.code(statusCode).send(body);
    });

    app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
      const body: ErrorResponse = {
        error: { code: 'NOT_FOUND', message: `Route ${request.method} ${request.url} not found` },
      };
      return reply.code(404).send(body);
    });
  },
  { name: 'shapio-error-handler' },
);
