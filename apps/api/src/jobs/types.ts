import type { FastifyBaseLogger } from 'fastify';
import type { Transaction } from 'kysely';
import type { DB } from '../db/types.js';
import type { OutboxEventRow } from '../repositories/outboxEvents.js';

export type JobLogger = FastifyBaseLogger;

/**
 * What a handler receives. Delivery is at least once: a handler may run again after a crash, so every
 * side effect must be idempotent (use `id` or `idempotencyKey`) or resume from `checkpoint`.
 */
export type JobContext = {
  id: string;
  type: string;
  payload: unknown;
  /** 1 on the first run. */
  attempt: number;
  maxAttempts: number;
  idempotencyKey: string | null;
  /** Progress saved by an earlier attempt, or null. */
  checkpoint: unknown;
  /** Persists progress so a retried attempt can resume. Returns false if this worker lost the lease. */
  saveCheckpoint: (checkpoint: unknown) => Promise<boolean>;
  /** Aborted on shutdown; long handlers should stop at the next safe point. */
  signal: AbortSignal;
  log: JobLogger;
};

/** Returns an optional JSON-serialisable result. Throw to fail the attempt; the queue retries with backoff. */
export type JobHandler = (context: JobContext) => Promise<unknown>;

export type JobHandlers = ReadonlyMap<string, JobHandler>;

/** A thrown error of this class marks the job dead immediately instead of retrying. */
export class PermanentJobError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PermanentJobError';
  }
}

/**
 * Turns an outbox event into follow-up work (usually by enqueueing jobs) inside the relay's transaction.
 * Subscribers must only write to the database through `trx`; network calls belong in job handlers.
 */
export type OutboxSubscriber = (event: OutboxEventRow, trx: Transaction<DB>) => Promise<void>;
