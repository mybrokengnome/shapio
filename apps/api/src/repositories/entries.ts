import type { Kysely, Transaction } from 'kysely';
import { db } from '../db/index.js';
import type { DB } from '../db/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

const COLUMNS = [
  'id',
  'site_id',
  'model_id',
  'owner_app_user_id',
  'created_by_admin_id',
  'created_at',
  'updated_at',
  'deleted_at',
] as const;

export type NewEntry = {
  /** The site the entry belongs to, for good: entries never move between sites. */
  siteId: string;
  modelId: string;
  ownerAppUserId: string | null;
  createdByAdminId: string | null;
};

export const insert = (entry: NewEntry, trx: Executor = db) =>
  trx
    .insertInto('entries')
    .values({
      site_id: entry.siteId,
      model_id: entry.modelId,
      owner_app_user_id: entry.ownerAppUserId,
      created_by_admin_id: entry.createdByAdminId,
    })
    .returning(COLUMNS)
    .executeTakeFirstOrThrow();

export type EntryRow = Awaited<ReturnType<typeof insert>>;

/**
 * A live entry of a model on one site. Another site's entry reads as missing (sites plan §H: the site is a
 * tenancy boundary), exactly like an entry that does not exist.
 */
export const findLive = (id: string, modelId: string, siteId: string, executor: Executor = db) =>
  executor
    .selectFrom('entries')
    .select(COLUMNS)
    .where('id', '=', id)
    .where('model_id', '=', modelId)
    .where('site_id', '=', siteId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();

/**
 * Locks a live entry of one site for the rest of the transaction: every write to one entry is serialized.
 * Another site's entry reads as missing.
 */
export const lockLive = (id: string, modelId: string, siteId: string, trx: Transaction<DB>) =>
  trx
    .selectFrom('entries')
    .select(COLUMNS)
    .where('id', '=', id)
    .where('model_id', '=', modelId)
    .where('site_id', '=', siteId)
    .where('deleted_at', 'is', null)
    .forUpdate()
    .executeTakeFirst();

export const touch = (id: string, now: Date, trx: Executor = db) =>
  trx.updateTable('entries').set({ updated_at: now }).where('id', '=', id).execute();

export const softDelete = (id: string, now: Date, trx: Executor = db) =>
  trx.updateTable('entries').set({ deleted_at: now, updated_at: now }).where('id', '=', id).execute();

/** Soft-deletes entries left with no head at all (e.g. after their only locale was removed). */
export const softDeleteHeadless = (modelIds: readonly string[] | null, now: Date, trx: Executor = db) => {
  let query = trx
    .updateTable('entries')
    .set({ deleted_at: now, updated_at: now })
    .where('deleted_at', 'is', null)
    .where((eb) =>
      eb.not(
        eb.exists(
          eb.selectFrom('entry_heads').select('entry_id').whereRef('entry_heads.entry_id', '=', 'entries.id'),
        ),
      ),
    );
  if (modelIds) {
    query = query.where('model_id', 'in', modelIds);
  }
  return query.executeTakeFirst();
};

/** Live entries of a model on one site (a singleton holds at most one per site). */
export const countLive = async (
  modelId: string,
  siteId: string,
  executor: Executor = db,
): Promise<number> => {
  const row = await executor
    .selectFrom('entries')
    .select(({ fn }) => fn.countAll<string>().as('count'))
    .where('model_id', '=', modelId)
    .where('site_id', '=', siteId)
    .where('deleted_at', 'is', null)
    .executeTakeFirstOrThrow();
  return Number(row.count);
};

/**
 * The most live entries of a model any one site holds (a model may become a singleton only when no site
 * holds more than one entry).
 */
export const maxLivePerSite = async (modelId: string, executor: Executor = db): Promise<number> => {
  const row = await executor
    .selectFrom('entries')
    .select(({ fn }) => fn.countAll<string>().as('count'))
    .where('model_id', '=', modelId)
    .where('deleted_at', 'is', null)
    .groupBy('site_id')
    .orderBy('count', 'desc')
    .limit(1)
    .executeTakeFirst();
  return Number(row?.count ?? 0);
};

/** Live entries of a model on one site among `ids` (relation target checks: relations never cross sites). */
export const findLiveIds = async (
  modelId: string,
  ids: readonly string[],
  siteId: string,
  executor: Executor = db,
) => {
  if (ids.length === 0) {
    return [];
  }
  const rows = await executor
    .selectFrom('entries')
    .select('id')
    .where('model_id', '=', modelId)
    .where('site_id', '=', siteId)
    .where('id', 'in', ids)
    .where('deleted_at', 'is', null)
    .execute();
  return rows.map((row) => row.id);
};

/** Locks an entry row (live or not) for the rest of the transaction. */
export const lockById = (id: string, trx: Transaction<DB>) =>
  trx.selectFrom('entries').select(COLUMNS).where('id', '=', id).forUpdate().executeTakeFirst();

/** Entries by ID, live or not (relation targets, findings' row filters). */
export const findByIds = (ids: readonly string[], executor: Executor = db) =>
  ids.length === 0
    ? Promise.resolve([])
    : executor.selectFrom('entries').select(COLUMNS).where('id', 'in', ids).execute();

/** A page of live entry IDs in ID order, optionally of some models (health sweeps). */
export const listLiveIdsAfter = (
  input: { after: string | null; limit: number; modelIds?: readonly string[] },
  executor: Executor = db,
) => {
  let query = executor
    .selectFrom('entries')
    .select(['id', 'model_id'])
    .where('deleted_at', 'is', null)
    .orderBy('id')
    .limit(input.limit);
  if (input.after) {
    query = query.where('id', '>', input.after);
  }
  if (input.modelIds) {
    query =
      input.modelIds.length === 0
        ? query.where((eb) => eb.lit(false))
        : query.where('model_id', 'in', input.modelIds);
  }
  return query.execute();
};

/** Live entries per model on one site (one GROUP BY; the content counts of models without row filters). */
export const countLiveByModel = (siteId: string, modelIds: readonly string[], executor: Executor = db) =>
  modelIds.length === 0
    ? Promise.resolve([])
    : executor
        .selectFrom('entries')
        .select(['model_id', ({ fn }) => fn.countAll<string>().as('count')])
        .where('site_id', '=', siteId)
        .where('model_id', 'in', modelIds)
        .where('deleted_at', 'is', null)
        .groupBy('model_id')
        .execute();

/**
 * The entry's site as a subquery, for rows that carry a copy of it (heads, unique values, the publication
 * log, findings, schedules): a composite foreign key to `entries (id, site_id)` keeps the copy equal.
 * Pass the outer query's executor; the subquery is compiled into the outer statement.
 */
export const entrySiteOf = (executor: Executor, entryId: string) =>
  executor.selectFrom('entries').select('entries.site_id').where('entries.id', '=', entryId);
