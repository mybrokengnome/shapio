import type { Kysely, RawBuilder, Transaction } from 'kysely';
import type { HeadPageMeta, HeadRow } from '../content/compiler/compile.js';
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
  query: RawBuilder<{ total: string | number }>,
  executor: Executor = db,
): Promise<number> => Number((await query.execute(executor)).rows[0]?.total ?? 0);

/** A page's total (null when not asked for) and the publication sequence its statement saw (null: no site row). */
export type PageMeta = { total: number | null; seq: number | null };

const toPageMeta = (row: HeadPageMeta): PageMeta => ({
  total: row.page_total === null ? null : Number(row.page_total),
  seq: row.page_seq === null ? null : Number(row.page_seq),
});

/**
 * Runs a head page compiled by `compileHeadPage`: the rows, and the total and sequence carried on them (null
 * when the page is empty; then `runHeadPageMeta` in the same transaction reads them).
 */
export const runHeadPage = async (
  query: RawBuilder<HeadRow & HeadPageMeta>,
  executor: Executor = db,
): Promise<{ rows: HeadRow[]; meta: PageMeta | null }> => {
  const result = (await query.execute(executor)).rows;
  const [first] = result;
  return {
    rows: result.map(({ page_total: _total, page_seq: _seq, ...row }) => row),
    meta: first ? toPageMeta(first) : null,
  };
};

export const runHeadPageMeta = async (
  query: RawBuilder<HeadPageMeta>,
  executor: Executor = db,
): Promise<PageMeta> => {
  const [row] = (await query.execute(executor)).rows;
  return row ? toPageMeta(row) : { total: null, seq: null };
};

/** Runs `fn` in one REPEATABLE READ, read-only transaction: a response reads one consistent moment. */
export const withConsistentRead = <T>(fn: (trx: Transaction<DB>) => Promise<T>, database: Kysely<DB> = db) =>
  database.transaction().setIsolationLevel('repeatable read').setAccessMode('read only').execute(fn);
