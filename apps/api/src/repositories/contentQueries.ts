import type { Kysely, RawBuilder, Transaction } from 'kysely';
import type { HeadRow } from '../content/compiler/compile.js';
import { db } from '../db/index.js';
import type { DB } from '../db/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

/**
 * Executes head queries compiled by `content/compiler` (the only place content SQL is written). Kept as a
 * repository so services never run SQL themselves.
 */
export const runHeadQuery = async (query: RawBuilder<HeadRow>, executor: Executor = db): Promise<HeadRow[]> =>
  (await query.execute(executor)).rows;

export const runCountQuery = async (
  query: RawBuilder<{ total: string }>,
  executor: Executor = db,
): Promise<number> => Number((await query.execute(executor)).rows[0]?.total ?? 0);

/** Runs `fn` in one REPEATABLE READ, read-only transaction: a response reads one consistent moment. */
export const withConsistentRead = <T>(fn: (trx: Transaction<DB>) => Promise<T>, database: Kysely<DB> = db) =>
  database.transaction().setIsolationLevel('repeatable read').setAccessMode('read only').execute(fn);
