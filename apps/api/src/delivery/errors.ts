import { ShapioApiError } from '@shapio/client';
import type { Logger } from 'pino';
import { toErrorResponse, type ErrorLike } from '../helpers/errorResponse.js';

/**
 * The server's release and this library's differ, or the database predates in-process delivery: reading
 * across versions could run SQL against a schema it was not written for (plan next-in-process §2). Callers
 * that catch `ShapioApiError` see a 503 `VERSION_SKEW`.
 */
export class ShapioVersionSkewError extends ShapioApiError {
  readonly serverRelease: string | null;
  readonly libraryRelease: string;

  constructor(serverRelease: string | null, libraryRelease: string, options?: ErrorOptions) {
    super(503, {
      error: {
        code: 'VERSION_SKEW',
        message:
          serverRelease === null
            ? `The Shapio database has not been served by Shapio ${libraryRelease} yet; start the Shapio server ` +
              `of this release (or install the release the server runs) before reading in process`
            : `The Shapio server runs ${serverRelease} and this in-process reader is ${libraryRelease}; ` +
              'install the same release on both',
      },
    });
    this.name = 'ShapioVersionSkewError';
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
    this.serverRelease = serverRelease;
    this.libraryRelease = libraryRelease;
  }
}

/** Thrown when the runtime cannot be created for this database (SQLite, an unknown URL, a second database). */
export class DeliveryRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeliveryRuntimeError';
  }
}

/** The body and status the HTTP API would have answered, thrown as the client throws it. */
export const toShapioApiError = (error: unknown, log: Pick<Logger, 'error'>): ShapioApiError => {
  if (error instanceof ShapioApiError) {
    return error;
  }
  const failure = error instanceof Error ? (error as ErrorLike) : new Error(String(error));
  const { statusCode, body } = toErrorResponse(failure);
  if (statusCode >= 500) {
    log.error({ err: error }, 'in-process delivery read failed');
  }
  return new ShapioApiError(statusCode, body);
};
