import type { Insertable, Kysely, Selectable, Transaction } from 'kysely';
import { db } from '../db/index.js';
import type { DB, Sites } from '../db/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

export type SiteRow = Selectable<Sites>;
export type NewSite = Pick<Insertable<Sites>, 'key' | 'name'>;

export const list = (trx: Executor = db) =>
  trx.selectFrom('sites').selectAll().orderBy('is_primary', 'desc').orderBy('name').orderBy('key').execute();

export const findById = (id: string, trx: Executor = db) =>
  trx.selectFrom('sites').selectAll().where('id', '=', id).executeTakeFirst();

export const findByKey = (key: string, trx: Executor = db) =>
  trx.selectFrom('sites').selectAll().where('key', '=', key).executeTakeFirst();

export const findPrimary = (trx: Executor = db) =>
  trx.selectFrom('sites').selectAll().where('is_primary', '=', true).executeTakeFirstOrThrow();

export const findByIds = (ids: readonly string[], trx: Executor = db) =>
  ids.length === 0
    ? Promise.resolve([])
    : trx
        .selectFrom('sites')
        .selectAll()
        .where('id', 'in', ids)
        .orderBy('is_primary', 'desc')
        .orderBy('name')
        .execute();

export const insert = (site: NewSite, trx: Executor = db) =>
  trx.insertInto('sites').values(site).returningAll().executeTakeFirstOrThrow();

/** Every site starts its own publication sequence at 0 (snapshot numbers are per site). */
export const insertPublicationState = (siteId: string, trx: Executor = db) =>
  trx.insertInto('publication_state').values({ site_id: siteId }).execute();

/** Optimistic update: applies only if the stored version is `expectedVersion`; bumps the version. */
export const renameIfVersion = (id: string, expectedVersion: number, name: string, trx: Executor = db) =>
  trx
    .updateTable('sites')
    .set((eb) => ({ name, version: eb('version', '+', 1), updated_at: new Date() }))
    .where('id', '=', id)
    .where('version', '=', expectedVersion)
    .returningAll()
    .executeTakeFirst();

export const lockById = (id: string, trx: Transaction<DB>) =>
  trx.selectFrom('sites').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();

/**
 * What keeps a site from being deleted: live content, media, change sets and app users (counted per kind).
 * Soft-deleted entries, media assets and app users do not count; `deleteSite` purges them with the site.
 */
export const countContents = async (siteId: string, trx: Executor = db) => {
  const count = (
    table: 'entries' | 'media_assets' | 'media_folders' | 'change_sets' | 'app_users',
    liveOnly = false,
  ) => {
    let query = trx
      .selectFrom(table)
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('site_id', '=', siteId);
    if (liveOnly) {
      query = query.where('deleted_at', 'is', null);
    }
    return query.executeTakeFirstOrThrow().then((row) => Number(row.n));
  };
  const [entries, mediaAssets, mediaFolders, changeSets, appUsers] = await Promise.all([
    count('entries', true),
    count('media_assets', true),
    count('media_folders'),
    count('change_sets'),
    count('app_users', true),
  ]);
  return { entries, mediaAssets, mediaFolders, changeSets, appUsers };
};

export const deleteById = (id: string, trx: Executor = db) =>
  trx.deleteFrom('sites').where('id', '=', id).executeTakeFirst();
