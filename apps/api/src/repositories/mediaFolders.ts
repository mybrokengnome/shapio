import type { Insertable, Kysely, Selectable, Transaction } from 'kysely';
import { db } from '../db/index.js';
import type { DB, MediaFolders } from '../db/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

export type MediaFolderRow = Selectable<MediaFolders>;

const FOLDER_COLUMNS = [
  'id',
  'site_id',
  'parent_id',
  'name',
  'created_by',
  'version',
  'created_at',
  'updated_at',
] as const;

/** Every folder of a site with its live asset count; the tree is small enough to send whole. */
export const listWithCounts = (siteId: string, trx: Executor = db) =>
  trx
    .selectFrom('media_folders')
    .select(FOLDER_COLUMNS.map((column) => `media_folders.${column}` as const))
    .select((eb) =>
      eb
        .selectFrom('media_assets')
        .select((sub) => sub.fn.countAll<string>().as('count'))
        .whereRef('media_assets.folder_id', '=', 'media_folders.id')
        .where('media_assets.deleted_at', 'is', null)
        .as('asset_count'),
    )
    .where('media_folders.site_id', '=', siteId)
    .orderBy('media_folders.name')
    .execute();

/** A folder of one site; another site's folder reads as missing. */
export const findById = (siteId: string, id: string, trx: Executor = db) =>
  trx
    .selectFrom('media_folders')
    .select(FOLDER_COLUMNS)
    .where('site_id', '=', siteId)
    .where('id', '=', id)
    .executeTakeFirst();

export const insert = (folder: Insertable<MediaFolders>, trx: Executor = db) =>
  trx.insertInto('media_folders').values(folder).returning(FOLDER_COLUMNS).executeTakeFirstOrThrow();

export const updateIfVersion = (
  siteId: string,
  id: string,
  expectedVersion: number,
  patch: { name?: string; parent_id?: string | null },
  trx: Executor = db,
) =>
  trx
    .updateTable('media_folders')
    .set((eb) => ({ ...patch, version: eb('version', '+', 1), updated_at: new Date() }))
    .where('site_id', '=', siteId)
    .where('id', '=', id)
    .where('version', '=', expectedVersion)
    .returning(FOLDER_COLUMNS)
    .executeTakeFirst();

export const deleteById = async (siteId: string, id: string, trx: Executor = db) =>
  (
    await trx
      .deleteFrom('media_folders')
      .where('site_id', '=', siteId)
      .where('id', '=', id)
      .executeTakeFirst()
  ).numDeletedRows > 0n;

export const hasChildren = async (id: string, trx: Executor = db) =>
  (await trx
    .selectFrom('media_folders')
    .select('id')
    .where('parent_id', '=', id)
    .limit(1)
    .executeTakeFirst()) !== undefined;

/**
 * IDs of `id` and all its ancestors (to reject moving a folder under itself). A folder's parents are on its
 * site (composite foreign key), so the walk never leaves it.
 */
export const listAncestorIds = async (id: string, trx: Executor = db) =>
  (
    await trx
      .withRecursive('ancestors(id, parent_id)', (qb) =>
        qb
          .selectFrom('media_folders')
          .select(['id', 'parent_id'])
          .where('id', '=', id)
          .unionAll((union) =>
            union
              .selectFrom('media_folders')
              .innerJoin('ancestors', 'ancestors.parent_id', 'media_folders.id')
              .select(['media_folders.id', 'media_folders.parent_id']),
          ),
      )
      .selectFrom('ancestors')
      .select('id')
      .execute()
  ).map((row) => row.id);
