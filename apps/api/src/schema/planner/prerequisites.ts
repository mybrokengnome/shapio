import type { Transaction } from 'kysely';
import type { DB } from '../../db/types.js';
import { enqueueJob } from '../../jobs/queue.js';
import type { ChangePlan } from './plan.js';

/**
 * Job definitions for schema changes (ADR 0007 queue). Prerequisites of one change run in order inside a
 * single resumable `schema.change` job (checkpointed per step), which then activates the revision. A
 * `schema apply` that needs prerequisites runs all its changes in one such job and activates them together.
 * Post-activation work runs as one idempotent `schema.followUp` job.
 */
export const SCHEMA_CHANGE_JOB = 'schema.change';
export const SCHEMA_FOLLOW_UP_JOB = 'schema.followUp';

/** Index builds and scans can take long; they resume from checkpoints, so a few attempts suffice. */
const SCHEMA_JOB_MAX_ATTEMPTS = 5;

/** One change, or several that activate together (a `schema apply`; checkpointed per change). */
export type SchemaChangeJobPayload = { changeId: string } | { changeIds: string[] };
export type SchemaFollowUpJobPayload = { definitionId: string | null; steps: ChangePlan['followUps'] };

export const changeIdsOf = (payload: SchemaChangeJobPayload): string[] =>
  'changeIds' in payload ? payload.changeIds : [payload.changeId];

/**
 * Enqueues the job that runs the changes' prerequisites and activates them, atomically with the change rows.
 * One change keeps the single-change payload (and its checkpoint at the root).
 */
export const enqueueSchemaChange = (trx: Transaction<DB>, changeIds: readonly [string, ...string[]]) =>
  enqueueJob(
    {
      type: SCHEMA_CHANGE_JOB,
      payload: (changeIds.length === 1
        ? { changeId: changeIds[0] }
        : { changeIds: [...changeIds] }) satisfies SchemaChangeJobPayload,
      idempotencyKey: `${SCHEMA_CHANGE_JOB}:${changeIds[0]}`,
      maxAttempts: SCHEMA_JOB_MAX_ATTEMPTS,
    },
    trx,
  );

/** Enqueues post-activation work (index builds for new models, index drops, unique-registry cleanup). */
export const enqueueFollowUps = async (trx: Transaction<DB>, plan: ChangePlan, activationKey: string) => {
  if (plan.followUps.length === 0) {
    return;
  }
  await enqueueJob(
    {
      type: SCHEMA_FOLLOW_UP_JOB,
      payload: { definitionId: plan.definitionId, steps: plan.followUps } satisfies SchemaFollowUpJobPayload,
      idempotencyKey: `${SCHEMA_FOLLOW_UP_JOB}:${activationKey}`,
      maxAttempts: SCHEMA_JOB_MAX_ATTEMPTS,
    },
    trx,
  );
};
