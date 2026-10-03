import type { Kysely, Transaction } from 'kysely';
import { db } from '../db/index.js';
import { concat } from '../db/sql/text.js';
import type { DB } from '../db/types.js';
import { beforeCursor, cursorAt, type KeysetCursor } from '../publishing/pagination.js';

type Executor = Kysely<DB> | Transaction<DB>;

/** The admin jobs view (package H): listing, counts and manual retry of dead jobs. */
export type JobListFilter = { status?: string; type?: string };

export const list = (
  filter: JobListFilter,
  cursor: KeysetCursor | undefined,
  limit: number,
  trx: Executor = db,
) =>
  trx
    .selectFrom('jobs')
    .selectAll()
    .select(cursorAt('jobs.created_at').as('cursor_at'))
    .$if(filter.status !== undefined, (qb) => qb.where('status', '=', filter.status ?? ''))
    .$if(filter.type !== undefined, (qb) => qb.where('type', '=', filter.type ?? ''))
    .$if(cursor !== undefined, (qb) =>
      qb.where(beforeCursor('jobs.created_at', 'jobs.id', cursor as KeysetCursor)),
    )
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(limit)
    .execute();

export const countByStatus = (trx: Executor = db) =>
  trx
    .selectFrom('jobs')
    .select(['status', (eb) => eb.fn.countAll<string>().as('n')])
    .groupBy('status')
    .execute();

export const distinctTypes = async (trx: Executor = db): Promise<string[]> =>
  (await trx.selectFrom('jobs').select('type').distinct().orderBy('type').execute()).map((row) => row.type);

/** Puts a dead job back in the queue as if new. Only dead jobs; returns undefined otherwise. */
export const requeueDead = (id: string, now: Date, trx: Executor = db) =>
  trx
    .updateTable('jobs')
    .set((eb) => ({
      status: 'pending',
      attempts: 0,
      run_at: now,
      finished_at: null,
      locked_by: null,
      locked_until: null,
      updated_at: now,
      last_error: eb
        .case()
        .when('last_error', 'is', null)
        .then(null)
        .else(concat('Retried by an admin after: ', eb.ref('last_error')))
        .end(),
    }))
    .where('id', '=', id)
    .where('status', '=', 'dead')
    .returningAll()
    .executeTakeFirst();
