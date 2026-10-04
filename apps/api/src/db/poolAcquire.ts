import { AppError } from '../helpers/appError.js';

/**
 * How long a query waits for a free pooled connection (PostgreSQL and MySQL) before it fails with
 * `PoolAcquireTimeoutError`. Without a bound, an exhausted pool queues requests forever and the server
 * stops answering until it restarts. SQLite has no such wait (see `db/sqlite/driver.ts`).
 */
export const DEFAULT_POOL_ACQUIRE_TIMEOUT_MS = 10_000;

/**
 * No pooled connection became free in time. A 503 the client may retry; the central error handler logs it
 * as a failed request, so an exhausted pool shows in the logs instead of as a silent hang.
 */
export class PoolAcquireTimeoutError extends AppError {
  constructor(timeoutMs: number, poolMax: number, options?: ErrorOptions) {
    super(
      503,
      'DATABASE_BUSY',
      `No database connection became free within ${timeoutMs} ms (pool of ${poolMax}); try again shortly`,
      undefined,
      options,
    );
    this.name = 'PoolAcquireTimeoutError';
  }
}

/**
 * Opening a new connection took longer than the acquire timeout: the database is unreachable or overloaded.
 * A 503 the client may retry, logged by the central error handler like `PoolAcquireTimeoutError`.
 */
export class DatabaseUnavailableError extends AppError {
  constructor(timeoutMs: number, options?: ErrorOptions) {
    super(
      503,
      'DATABASE_UNAVAILABLE',
      `Could not connect to the database within ${timeoutMs} ms; try again shortly`,
      undefined,
      options,
    );
    this.name = 'DatabaseUnavailableError';
  }
}

/** pg-pool's error when `connectionTimeoutMillis` passes while the request waits in the pool's queue. */
const PG_QUEUE_TIMEOUT_MESSAGE = 'timeout exceeded when trying to connect';
/** pg-pool's error when `connectionTimeoutMillis` passes while it opens a new connection. */
const PG_CONNECT_TIMEOUT_MESSAGE = 'Connection terminated due to connection timeout';

/** The 503 for a pg-pool acquisition error, or the error itself when it is not a timeout. */
export const pgAcquireError = (error: unknown, poolMax: number, timeoutMs: number): unknown => {
  if (!(error instanceof Error)) {
    return error;
  }
  if (error.message === PG_QUEUE_TIMEOUT_MESSAGE) {
    return new PoolAcquireTimeoutError(timeoutMs, poolMax, { cause: error });
  }
  if (error.message === PG_CONNECT_TIMEOUT_MESSAGE) {
    return new DatabaseUnavailableError(timeoutMs, { cause: error });
  }
  return error;
};
