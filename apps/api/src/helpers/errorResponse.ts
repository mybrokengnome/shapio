import type { ErrorResponse } from '../routes/schemas/error.js';
import { AppError } from './appError.js';

/**
 * What the error response reads from an error that is not an `AppError`: the parts Fastify's errors carry
 * (status, code, request-validation issues). Structural, so callers outside Fastify (the in-process delivery
 * runtime) share this mapping without importing it.
 */
export type ErrorLike = Error & {
  code?: string;
  statusCode?: number;
  validation?: ReadonlyArray<{ instancePath: string; message?: string; params: unknown }>;
};

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

export type ErrorResult = { statusCode: number; body: ErrorResponse };

/**
 * The one error shape every endpoint returns, `{ error: { code, message, details? } }`, and its status.
 * Server errors (5xx) never carry their internal text; the caller logs the original error.
 */
export const toErrorResponse = (error: ErrorLike | AppError): ErrorResult => {
  if (error instanceof AppError) {
    const body: ErrorResponse = { error: { code: error.code, message: error.message } };
    if (error.details !== undefined) {
      body.error.details = error.details;
    }
    return { statusCode: error.statusCode, body };
  }
  if (error.code !== undefined && CSRF_ERROR_CODES.has(error.code)) {
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
