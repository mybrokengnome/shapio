import type { Kysely, Transaction } from 'kysely';
import { db } from '../db/index.js';
import type { DB } from '../db/types.js';
import * as jobsRepository from '../repositories/jobs.js';
import type { JobRow } from '../repositories/jobs.js';

type Executor = Kysely<DB> | Transaction<DB>;

export const DEFAULT_MAX_ATTEMPTS = 10;

export type EnqueueJobInput = {
  type: string;
  payload?: Record<string, unknown>;
  /** Defaults to now. */
  runAt?: Date;
  /** Higher runs first. */
  priority?: number;
  maxAttempts?: number;
  /** Enqueueing the same key twice creates one job; the second call returns the existing one. */
  idempotencyKey?: string;
};

export type EnqueueJobResult = { job: JobRow; created: boolean };

/**
 * Adds a job. Pass the transaction of the domain change that caused it, so the job exists only if the
 * change commits.
 */
export const enqueueJob = async (input: EnqueueJobInput, trx: Executor = db): Promise<EnqueueJobResult> => {
  const inserted = await jobsRepository.insertIdempotent(
    {
      type: input.type,
      payload: JSON.stringify(input.payload ?? {}),
      run_at: input.runAt ?? new Date(),
      priority: input.priority ?? 0,
      max_attempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      idempotency_key: input.idempotencyKey ?? null,
    },
    trx,
  );
  if (inserted) {
    return { job: inserted, created: true };
  }
  // Only reachable with an idempotency key: the insert conflicted on it.
  const existing = await jobsRepository.findByIdempotencyKey(input.idempotencyKey ?? '', trx);
  if (!existing) {
    throw new Error(`Job with idempotency key ${input.idempotencyKey ?? ''} conflicted but was not found`);
  }
  return { job: existing, created: false };
};
