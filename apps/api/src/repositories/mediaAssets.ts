import type { Insertable, Kysely, Selectable, Transaction, Updateable } from 'kysely';
import { db } from '../db/index.js';
import type { DB, MediaAssets } from '../db/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

export type MediaAssetRow = Selectable<MediaAssets>;
export type NewMediaAsset = Insertable<MediaAssets>;
export type MediaAssetPatch = Updateable<MediaAssets>;

export type MediaAssetFilter = {
  /** A folder ID, `null` for the root (no folder), or undefined for every folder. */
  folderId?: string | null;
  /** `image/png`, or a top-level type with a wildcard: `image/*`. */
  mimeType?: string;
  /** Matches the file name, alt text and caption, case-insensitively. */
  search?: string;
};

/** Keyset cursor: (created_at, id) of the last row, created_at as ISO-8601 with microseconds. */
export type MediaAssetCursor = { createdAt: string; id: string };

const escapeLike = (value: string) => value.replace(/[\\%_]/g, '\\$&');

const live = (trx: Executor) => trx.selectFrom('media_assets').where('deleted_at', 'is', null);

export const insert = (asset: NewMediaAsset, trx: Executor = db) =>
  trx.insertInto('media_assets').values(asset).returningAll().executeTakeFirstOrThrow();

export const findById = (id: string, trx: Executor = db) =>
  trx.selectFrom('media_assets').selectAll().where('id', '=', id).executeTakeFirst();

export const findLiveById = (id: string, trx: Executor = db) =>
  live(trx).selectAll().where('id', '=', id).executeTakeFirst();

export const findLiveByIds = (ids: readonly string[], trx: Executor = db) =>
  ids.length === 0 ? Promise.resolve([]) : live(trx).selectAll().where('id', 'in', ids).execute();

/** Locks the row for the rest of the transaction (deleted rows too, so callers can report them). */
export const lockById = (id: string, trx: Transaction<DB>) =>
  trx.selectFrom('media_assets').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();

export const findLiveByStorageKey = (key: string, trx: Executor = db) =>
  live(trx).selectAll().where('storage_key', '=', key).executeTakeFirst();

export const update = (id: string, patch: MediaAssetPatch, trx: Executor = db) =>
  trx
    .updateTable('media_assets')
    .set({ ...patch, updated_at: new Date() })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirstOrThrow();

/** Changes made by jobs: only while the asset still has `storageKey` (not replaced, moved or deleted). */
export const updateIfStorageKey = (
  id: string,
  storageKey: string,
  patch: MediaAssetPatch,
  trx: Executor = db,
) =>
  trx
    .updateTable('media_assets')
    .set({ ...patch, updated_at: new Date() })
    .where('id', '=', id)
    .where('storage_key', '=', storageKey)
    .where('deleted_at', 'is', null)
    .returningAll()
    .executeTakeFirst();

/** Metadata edits by people: only when the caller saw the current version (optimistic concurrency). */
export const updateIfVersion = (
  id: string,
  expectedVersion: number,
  patch: MediaAssetPatch,
  trx: Executor = db,
) =>
  trx
    .updateTable('media_assets')
    .set((eb) => ({ ...patch, version: eb('version', '+', 1), updated_at: new Date() }))
    .where('id', '=', id)
    .where('version', '=', expectedVersion)
    .where('deleted_at', 'is', null)
    .returningAll()
    .executeTakeFirst();

export const list = (
  filter: MediaAssetFilter,
  cursor: MediaAssetCursor | undefined,
  limit: number,
  trx: Executor = db,
) =>
  live(trx)
    .selectAll()
    .select((eb) =>
      eb
        .fn<string>('to_char', [
          eb.fn('timezone', [eb.val('UTC'), eb.ref('created_at')]),
          eb.val('YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        ])
        .as('cursor_at'),
    )
    .$if(filter.folderId !== undefined, (qb) =>
      filter.folderId === null
        ? qb.where('folder_id', 'is', null)
        : qb.where('folder_id', '=', filter.folderId ?? ''),
    )
    .$if(filter.mimeType !== undefined, (qb) => {
      const mimeType = filter.mimeType ?? '';
      return mimeType.endsWith('/*')
        ? qb.where('mime_type', 'like', `${escapeLike(mimeType.slice(0, -1))}%`)
        : qb.where('mime_type', '=', mimeType);
    })
    .$if(filter.search !== undefined, (qb) => {
      const pattern = `%${escapeLike(filter.search ?? '')}%`;
      return qb.where((eb) =>
        eb.or([
          eb('original_filename', 'ilike', pattern),
          eb('alt', 'ilike', pattern),
          eb('caption', 'ilike', pattern),
        ]),
      );
    })
    .$if(cursor !== undefined, (qb) =>
      qb.where((eb) => {
        const at = eb.cast<Date>(eb.val(cursor?.createdAt ?? null), 'timestamptz');
        return eb.or([
          eb('created_at', '<', at),
          eb.and([eb('created_at', '=', at), eb('id', '<', cursor?.id ?? '')]),
        ]);
      }),
    )
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(limit)
    .execute();

/** Moves live assets into a folder (or the root); returns the IDs that moved. */
export const moveToFolder = async (ids: readonly string[], folderId: string | null, trx: Executor = db) =>
  (
    await trx
      .updateTable('media_assets')
      .set((eb) => ({ folder_id: folderId, version: eb('version', '+', 1), updated_at: new Date() }))
      .where('id', 'in', ids)
      .where('deleted_at', 'is', null)
      .returning('id')
      .execute()
  ).map((row) => row.id);

export const countLiveInFolder = async (folderId: string, trx: Executor = db) =>
  Number(
    (
      await live(trx)
        .select((eb) => eb.fn.countAll<string>().as('count'))
        .where('folder_id', '=', folderId)
        .executeTakeFirstOrThrow()
    ).count,
  );

/** Live assets on a driver, in ID order after `afterId` (for `shapio media migrate`). */
export const listLiveByDriver = (
  driver: string,
  afterId: string | undefined,
  limit: number,
  trx: Executor = db,
) =>
  live(trx)
    .selectAll()
    .where('storage_driver', '=', driver)
    .$if(afterId !== undefined, (qb) => qb.where('id', '>', afterId ?? ''))
    .orderBy('id')
    .limit(limit)
    .execute();

/** Library alt text and type of live assets (content health's alt-text rule). */
export const findAltByIds = (ids: readonly string[], executor: Executor = db) =>
  ids.length === 0
    ? Promise.resolve([])
    : executor
        .selectFrom('media_assets')
        .select(['id', 'alt', 'mime_type'])
        .where('id', 'in', ids)
        .where('deleted_at', 'is', null)
        .execute();
