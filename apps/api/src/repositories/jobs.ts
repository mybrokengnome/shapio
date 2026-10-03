import type { Insertable, Kysely, Selectable, Transaction } from 'kysely';
import { db } from '../db/index.js';
import { greatestOf } from '../db/sql/time.js';
import type { DB, Jobs } from '../db/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

export type JobRow = Selectable<Jobs>;
export type NewJob = Insertable<Jobs>;

/** Inserts a job; with an idempotency key, a second insert of the same key is a no-op returning undefined. */
export const insertIdempotent = (job: NewJob, trx: Executor = db) =>
  trx
    .insertInto('jobs')
    .values(job)
    .onConflict((oc) => oc.column('idempotency_key').where('idempotency_key', 'is not', null).doNothing())
    .returningAll()
    .executeTakeFirst();

export const findById = (id: string, trx: Executor = db) =>
  trx.selectFrom('jobs').selectAll().where('id', '=', id).executeTakeFirst();

export const findByIdempotencyKey = (key: string, trx: Executor = db) =>
  trx.selectFrom('jobs').selectAll().where('idempotency_key', '=', key).executeTakeFirst();

type ClaimOptions = { workerId: string; limit: number; now: Date; leaseUntil: Date };

/**
 * Atomically leases up to `limit` runnable jobs: pending jobs that are due, and running jobs whose lease
 * expired (their worker died). `SKIP LOCKED` lets concurrent workers claim disjoint sets without waiting.
 */
export const claimRunnable = ({ workerId, limit, now, leaseUntil }: ClaimOptions, trx: Executor = db) =>
  trx
    .updateTable('jobs')
    .set((eb) => ({
      status: 'running',
      locked_by: workerId,
      locked_until: leaseUntil,
      attempts: eb('attempts', '+', eb.lit(1)),
      updated_at: now,
    }))
    .where('id', 'in', (eb) =>
      eb
        .selectFrom('jobs')
        .select('id')
        .where((w) =>
          w.or([
            w.and([w('status', '=', 'pending'), w('run_at', '<=', now)]),
            w.and([w('status', '=', 'running'), w('locked_until', '<', now)]),
          ]),
        )
        .orderBy('priority', 'desc')
        .orderBy('run_at', 'asc')
        .limit(limit)
        .forUpdate()
        .skipLocked(),
    )
    .returningAll()
    .execute();

type LeaseFence = { id: string; workerId: string };

/**
 * Every write by a worker is fenced on (id, locked_by, status = running), so a worker whose lease expired
 * and was taken over cannot overwrite the new owner's state. Returns true when the write applied.
 */
const fenced = (trx: Executor, { id, workerId }: LeaseFence) =>
  trx
    .updateTable('jobs')
    .where('id', '=', id)
    .where('locked_by', '=', workerId)
    .where('status', '=', 'running');

const applied = (result: { numUpdatedRows: bigint }) => result.numUpdatedRows > 0n;

export const markSucceeded = async (fence: LeaseFence, result: unknown, now: Date, trx: Executor = db) =>
  applied(
    await fenced(trx, fence)
      .set({
        status: 'succeeded',
        result: result === undefined ? null : JSON.stringify(result),
        locked_by: null,
        locked_until: null,
        last_error: null,
        finished_at: now,
        updated_at: now,
      })
      .executeTakeFirst(),
  );

export const markForRetry = async (
  fence: LeaseFence,
  error: string,
  runAt: Date,
  now: Date,
  trx: Executor = db,
) =>
  applied(
    await fenced(trx, fence)
      .set({
        status: 'pending',
        run_at: runAt,
        locked_by: null,
        locked_until: null,
        last_error: error,
        updated_at: now,
      })
      .executeTakeFirst(),
  );

export const markDead = async (fence: LeaseFence, error: string, now: Date, trx: Executor = db) =>
  applied(
    await fenced(trx, fence)
      .set({
        status: 'dead',
        locked_by: null,
        locked_until: null,
        last_error: error,
        finished_at: now,
        updated_at: now,
      })
      .executeTakeFirst(),
  );

/** Returns a leased job to the queue without counting the attempt (graceful shutdown). */
export const release = async (fence: LeaseFence, now: Date, trx: Executor = db) =>
  applied(
    await fenced(trx, fence)
      .set((eb) => ({
        status: 'pending',
        run_at: now,
        attempts: greatestOf(eb('attempts', '-', eb.lit(1)), eb.lit(0)),
        locked_by: null,
        locked_until: null,
        updated_at: now,
      }))
      .executeTakeFirst(),
  );

export const extendLease = async (fence: LeaseFence, leaseUntil: Date, now: Date, trx: Executor = db) =>
  applied(await fenced(trx, fence).set({ locked_until: leaseUntil, updated_at: now }).executeTakeFirst());

export const saveCheckpoint = async (fence: LeaseFence, checkpoint: unknown, now: Date, trx: Executor = db) =>
  applied(
    await fenced(trx, fence)
      .set({ checkpoint: JSON.stringify(checkpoint), updated_at: now })
      .executeTakeFirst(),
  );
