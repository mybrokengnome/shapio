import type { Insertable, Kysely, Selectable, Transaction, Updateable } from 'kysely';
import { db } from '../db/index.js';
import type { AssistRuns, DB } from '../db/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

export type AssistRunRow = Selectable<AssistRuns>;
export type NewAssistRun = Insertable<AssistRuns>;
export type AssistRunPatch = Updateable<AssistRuns>;

export const insert = (run: NewAssistRun, trx: Executor = db) =>
  trx.insertInto('assist_runs').values(run).returningAll().executeTakeFirstOrThrow();

/** One run of a site; another site's run reads as missing. */
export const findOnSite = (siteId: string, id: string, trx: Executor = db) =>
  trx
    .selectFrom('assist_runs')
    .selectAll()
    .where('site_id', '=', siteId)
    .where('id', '=', id)
    .executeTakeFirst();

export const findById = (id: string, trx: Executor = db) =>
  trx.selectFrom('assist_runs').selectAll().where('id', '=', id).executeTakeFirst();

export const update = (id: string, patch: AssistRunPatch, trx: Executor = db) =>
  trx.updateTable('assist_runs').set(patch).where('id', '=', id).returningAll().executeTakeFirst();

/** Runs and tokens of a site since `since` (the status endpoint's monthly usage). */
export const usageSince = (siteId: string, since: Date, trx: Executor = db) =>
  trx
    .selectFrom('assist_runs')
    .select((eb) => [
      eb.fn.countAll<string>().as('runs'),
      eb.fn.coalesce(eb.fn.sum<string>('input_tokens'), eb.lit(0)).as('input_tokens'),
      eb.fn.coalesce(eb.fn.sum<string>('output_tokens'), eb.lit(0)).as('output_tokens'),
    ])
    .where('site_id', '=', siteId)
    .where('created_at', '>=', since)
    .executeTakeFirstOrThrow();

const deleted = (result: { numDeletedRows: bigint }) => Number(result.numDeletedRows);

/** Deletes up to `limit` runs created before `before` (retention, USAGE_RETENTION_DAYS). */
export const pruneRuns = async (before: Date, limit: number, trx: Executor = db) =>
  deleted(
    await trx
      .deleteFrom('assist_runs')
      .where('id', 'in', (eb) =>
        eb.selectFrom('assist_runs').select('id').where('created_at', '<', before).limit(limit),
      )
      .executeTakeFirstOrThrow(),
  );
