import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { AppError } from '../helpers/appError.js';
import { toErrorResponse } from '../helpers/errorResponse.js';
import type { ErrorResponse } from '../routes/schemas/error.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** The `error.code` this handler answered with; the request's response line carries it (requestLog.ts). */
    errorCode: string | undefined;
  }
}

/** The single error handler: consistent `{ error: { code, message, details? } }` bodies and logging. */
export const errorHandlerPlugin = fp(
  async (app: FastifyInstance) => {
    app.decorateRequest('errorCode', undefined);

    app.setErrorHandler((error: FastifyError | AppError, request: FastifyRequest, reply: FastifyReply) => {
      const { statusCode, body } = toErrorResponse(error);
      request.errorCode = body.error.code;
      if (statusCode >= 500) {
        request.log.error({ err: error }, 'request failed');
      } else {
        // The response line (plugins/requestLog.ts) carries the status and code at info.
        request.log.debug({ statusCode, code: body.error.code }, 'request rejected');
      }
      return reply.code(statusCode).send(body);
    });

    app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
      const body: ErrorResponse = {
        error: { code: 'NOT_FOUND', message: `Route ${request.method} ${request.url} not found` },
      };
      request.errorCode = body.error.code;
      return reply.code(404).send(body);
    });
  },
  { name: 'shapio-error-handler' },
);
