import type { Kysely, Selectable, Transaction } from 'kysely';
import { db } from '../db/index.js';
import type { DB, SchemaChangeJobs } from '../db/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

export type SchemaChangeJobRow = Selectable<SchemaChangeJobs>;
export type SchemaChangeStatus = 'pending' | 'running' | 'activated' | 'failed' | 'cancelled';
export type SchemaChangeTarget = { type: 'model' | 'locale'; id: string };

export type NewSchemaChangeJob = {
  target: SchemaChangeTarget;
  modelId: string | null;
  fromRevisionId: string | null;
  toRevisionId: string | null;
  plan: unknown;
  requestedByType: string;
  requestedById: string | null;
  /** The change set shipping this change (its job runs the set, not this change alone). */
  changeSetId?: string | null;
};

export const insert = (change: NewSchemaChangeJob, trx: Executor = db) =>
  trx
    .insertInto('schema_change_jobs')
    .values({
      target_type: change.target.type,
      target_id: change.target.id,
      model_id: change.modelId,
      from_revision_id: change.fromRevisionId,
      to_revision_id: change.toRevisionId,
      plan: JSON.stringify(change.plan),
      requested_by_type: change.requestedByType,
      requested_by_id: change.requestedById,
      change_set_id: change.changeSetId ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

export const findById = (id: string, executor: Executor = db) =>
  executor.selectFrom('schema_change_jobs').selectAll().where('id', '=', id).executeTakeFirst();

/** Locks the row for the caller's transaction (activation re-reads it under the schema lock). */
export const findByIdForUpdate = (id: string, trx: Transaction<DB>) =>
  trx.selectFrom('schema_change_jobs').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();

export const findInFlight = (target: SchemaChangeTarget, executor: Executor = db) =>
  executor
    .selectFrom('schema_change_jobs')
    .selectAll()
    .where('target_type', '=', target.type)
    .where('target_id', '=', target.id)
    .where('status', 'in', ['pending', 'running'])
    .executeTakeFirst();

export const findInFlightForModels = (modelIds: readonly string[], executor: Executor = db) =>
  modelIds.length === 0
    ? Promise.resolve([])
    : executor
        .selectFrom('schema_change_jobs')
        .selectAll()
        .where('model_id', 'in', modelIds)
        .where('status', 'in', ['pending', 'running'])
        .execute();

export const attachJob = (id: string, jobId: string, trx: Executor = db) =>
  trx.updateTable('schema_change_jobs').set({ job_id: jobId }).where('id', '=', id).execute();

export const markRunning = (id: string, now: Date, trx: Executor = db) =>
  trx
    .updateTable('schema_change_jobs')
    .set({ status: 'running', updated_at: now })
    .where('id', '=', id)
    .where('status', '=', 'pending')
    .execute();

/** Moves an in-flight change to a final status; returns false if it had already finished. */
export const finish = async (
  id: string,
  outcome: { status: Exclude<SchemaChangeStatus, 'pending' | 'running'>; error?: unknown; now: Date },
  trx: Executor = db,
): Promise<boolean> => {
  const result = await trx
    .updateTable('schema_change_jobs')
    .set({
      status: outcome.status,
      error: outcome.error === undefined ? null : JSON.stringify(outcome.error),
      updated_at: outcome.now,
      finished_at: outcome.now,
    })
    .where('id', '=', id)
    .where('status', 'in', ['pending', 'running'])
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
};

export const listForModel = (modelId: string, limit: number, executor: Executor = db) =>
  executor
    .selectFrom('schema_change_jobs')
    .selectAll()
    .where('model_id', '=', modelId)
    .orderBy('created_at', 'desc')
    .limit(limit)
    .execute();

/** The in-flight changes a change set is shipping (one per schema item). */
export const listInFlightForChangeSet = (changeSetId: string, executor: Executor = db) =>
  executor
    .selectFrom('schema_change_jobs')
    .selectAll()
    .where('change_set_id', '=', changeSetId)
    .where('status', 'in', ['pending', 'running'])
    .orderBy('created_at')
    .execute();
