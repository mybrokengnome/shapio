import type { Kysely, Transaction } from 'kysely';
import type { DB } from '../db/types.js';

/**
 * Reads the content write path makes under its locks (ADR 0002 transitional write policy): the active
 * versions to re-check at commit, and locale rows held so a locale cannot be deleted mid-write.
 */
export const findActiveVersions = (modelIds: readonly string[], trx: Transaction<DB>) =>
  trx
    .selectFrom('model_active_versions')
    .select(['model_id', 'version'])
    .where('model_id', 'in', modelIds)
    .execute();

/** Holds the locale rows until commit (FOR SHARE); returns the codes that exist. */
export const lockLocales = async (codes: readonly string[], trx: Transaction<DB>): Promise<string[]> => {
  if (codes.length === 0) {
    return [];
  }
  const rows = await trx
    .selectFrom('locales')
    .select('code')
    .where('code', 'in', codes)
    .orderBy('code')
    .forShare()
    .execute();
  return rows.map((row) => row.code);
};

/** Serializes creates of a singleton's only entry (a row lock on its model). */
export const lockModelRow = (modelId: string, trx: Transaction<DB>) =>
  trx.selectFrom('models').select('id').where('id', '=', modelId).forNoKeyUpdate().executeTakeFirst();

/**
 * Live media assets among `ids`, held FOR SHARE until commit: an asset cannot be deleted (package G locks it
 * FOR UPDATE and counts references) between this check and the reference rows this write adds.
 */
export const lockLiveMedia = (ids: readonly string[], trx: Transaction<DB>) =>
  ids.length === 0
    ? Promise.resolve([])
    : trx
        .selectFrom('media_assets')
        .select(['id', 'mime_type'])
        .where('id', 'in', ids)
        .where('deleted_at', 'is', null)
        .orderBy('id')
        .forShare()
        .execute();

/** Live media assets among `ids`, without a lock (read-only checks such as the publish pre-flight). */
export const findLiveMedia = (ids: readonly string[], executor: Kysely<DB> | Transaction<DB>) =>
  ids.length === 0
    ? Promise.resolve([])
    : executor
        .selectFrom('media_assets')
        .select(['id', 'mime_type'])
        .where('id', 'in', ids)
        .where('deleted_at', 'is', null)
        .execute();
