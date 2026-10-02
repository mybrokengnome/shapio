import type { Insertable, Kysely, Selectable, Transaction } from 'kysely';
import { db } from '../db/index.js';
import type { DB, ScheduledPublications } from '../db/types.js';
import { beforeCursor, cursorAt, type KeysetCursor } from '../publishing/pagination.js';

type Executor = Kysely<DB> | Transaction<DB>;

export type ScheduledPublicationRow = Selectable<ScheduledPublications>;
export type NewScheduledPublication = Insertable<ScheduledPublications>;

export const insert = (row: NewScheduledPublication, trx: Executor = db) =>
  trx.insertInto('scheduled_publications').values(row).returningAll().executeTakeFirstOrThrow();

export const findById = (id: string, trx: Executor = db) =>
  trx.selectFrom('scheduled_publications').selectAll().where('id', '=', id).executeTakeFirst();

export const lockById = (id: string, trx: Transaction<DB>) =>
  trx.selectFrom('scheduled_publications').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();

export const setJob = (id: string, jobId: string, trx: Executor = db) =>
  trx.updateTable('scheduled_publications').set({ job_id: jobId }).where('id', '=', id).execute();

export type ScheduleFilter = { status?: string; entryId?: string };

export const list = (
  filter: ScheduleFilter,
  cursor: KeysetCursor | undefined,
  limit: number,
  trx: Executor = db,
) =>
  trx
    .selectFrom('scheduled_publications')
    .selectAll()
    .select(cursorAt('scheduled_publications.created_at').as('cursor_at'))
    .$if(filter.status !== undefined, (qb) => qb.where('status', '=', filter.status ?? ''))
    .$if(filter.entryId !== undefined, (qb) => qb.where('entry_id', '=', filter.entryId ?? ''))
    .$if(cursor !== undefined, (qb) =>
      qb.where(
        beforeCursor(
          'scheduled_publications.created_at',
          'scheduled_publications.id',
          cursor as KeysetCursor,
        ),
      ),
    )
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(limit)
    .execute();

export const markDone = (id: string, snapshot: number | null, now: Date, trx: Executor = db) =>
  trx
    .updateTable('scheduled_publications')
    .set({
      status: 'done',
      snapshot_seq: snapshot === null ? null : String(snapshot),
      error: null,
      executed_at: now,
      updated_at: now,
    })
    .where('id', '=', id)
    .execute();

export const markFailed = (id: string, error: string, now: Date, trx: Executor = db) =>
  trx
    .updateTable('scheduled_publications')
    .set({ status: 'failed', error, executed_at: now, updated_at: now })
    .where('id', '=', id)
    .where('status', 'in', ['scheduled', 'failed'])
    .execute();

/** Cancels a schedule that has not run yet; returns the row when it changed. */
export const cancel = (id: string, now: Date, trx: Executor = db) =>
  trx
    .updateTable('scheduled_publications')
    .set({ status: 'cancelled', updated_at: now })
    .where('id', '=', id)
    .where('status', 'in', ['scheduled', 'failed'])
    .returningAll()
    .executeTakeFirst();
