import {
  sql,
  type Insertable,
  type Kysely,
  type Selectable,
  type Transaction,
  type Updateable,
} from 'kysely';
import { db } from '../db/index.js';
import type { ChangeSets, DB } from '../db/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

export type ChangeSetRow = Selectable<ChangeSets>;
export type ChangeSetStatus = 'open' | 'scheduled' | 'shipping' | 'shipped' | 'failed' | 'discarded';

export const insert = (row: Insertable<ChangeSets>, trx: Executor = db) =>
  trx.insertInto('change_sets').values(row).returningAll().executeTakeFirstOrThrow();

export const findById = (id: string, executor: Executor = db) =>
  executor.selectFrom('change_sets').selectAll().where('id', '=', id).executeTakeFirst();

export const lockById = (id: string, trx: Transaction<DB>) =>
  trx.selectFrom('change_sets').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();

/** Applies changes and bumps the version, optionally only at an expected version. */
export const update = (
  id: string,
  changes: Updateable<ChangeSets>,
  now: Date,
  trx: Executor = db,
  expectedVersion?: number,
) =>
  trx
    .updateTable('change_sets')
    .set({ ...changes, version: sql<number>`version + 1`, updated_at: now })
    .where('id', '=', id)
    .$if(expectedVersion !== undefined, (qb) => qb.where('version', '=', expectedVersion ?? 0))
    .returningAll()
    .executeTakeFirst();

export type ChangeSetListRow = ChangeSetRow & { entry_items: string | null; schema_items: string | null };

/** Newest first (keyset on created_at, id), with item counts. */
export const list = (
  filter: { statuses: readonly ChangeSetStatus[]; after?: { createdAt: Date; id: string }; limit: number },
  executor: Executor = db,
): Promise<ChangeSetListRow[]> => {
  let query = executor
    .selectFrom('change_sets')
    .selectAll('change_sets')
    .select((eb) => [
      eb
        .selectFrom('change_set_items')
        .select(eb.fn.countAll<string>().as('n'))
        .whereRef('change_set_items.change_set_id', '=', 'change_sets.id')
        .where('change_set_items.kind', '=', 'entry')
        .as('entry_items'),
      eb
        .selectFrom('change_set_items')
        .select(eb.fn.countAll<string>().as('n'))
        .whereRef('change_set_items.change_set_id', '=', 'change_sets.id')
        .where('change_set_items.kind', '=', 'schema')
        .as('schema_items'),
    ])
    .where('status', 'in', filter.statuses)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(filter.limit);
  if (filter.after) {
    const { createdAt, id } = filter.after;
    query = query.where((eb) =>
      eb.or([
        eb('created_at', '<', createdAt),
        eb.and([eb('created_at', '=', createdAt), eb('id', '<', id)]),
      ]),
    );
  }
  return query.execute();
};

/** Titles of change sets, for ledger rows and "also changed in". */
export const findTitles = (ids: readonly string[], executor: Executor = db) =>
  ids.length === 0
    ? Promise.resolve([])
    : executor.selectFrom('change_sets').select(['id', 'title']).where('id', 'in', ids).execute();

/** Display names of the admins and tokens that created sets (one query each kind). */
export const findActorNames = async (
  ids: { adminIds: readonly string[]; tokenIds: readonly string[] },
  executor: Executor = db,
): Promise<Map<string, string>> => {
  const names = new Map<string, string>();
  if (ids.adminIds.length > 0) {
    const rows = await executor
      .selectFrom('admin_users')
      .select(['id', 'name'])
      .where('id', 'in', ids.adminIds)
      .execute();
    rows.forEach((row) => names.set(row.id, row.name));
  }
  if (ids.tokenIds.length > 0) {
    const rows = await executor
      .selectFrom('api_tokens')
      .select(['id', 'name'])
      .where('id', 'in', ids.tokenIds)
      .execute();
    rows.forEach((row) => names.set(row.id, row.name));
  }
  return names;
};
