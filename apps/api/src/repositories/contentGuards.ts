import type { Kysely, Transaction } from 'kysely';
import { LOCK_NAMESPACE } from '../constants/lockKeys.js';
import { acquireXactLock, lockKeyFromId } from '../db/advisoryLocks.js';
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

/**
 * Serializes creates of a singleton's only entry on one site until commit (sites plan §H: a singleton has
 * one entry per site, so creates on different sites never wait for each other).
 */
export const lockSingleton = (modelId: string, siteId: string, trx: Transaction<DB>) =>
  acquireXactLock(trx, LOCK_NAMESPACE.singletons, lockKeyFromId(`${modelId}:${siteId}`));

/**
 * Live media assets of one site among `ids` (another site's asset reads as missing), held FOR SHARE until commit: an asset cannot be deleted (package G locks it
 * FOR UPDATE and counts references) between this check and the reference rows this write adds.
 */
export const lockLiveMedia = (ids: readonly string[], siteId: string, trx: Transaction<DB>) =>
  ids.length === 0
    ? Promise.resolve([])
    : trx
        .selectFrom('media_assets')
        .select(['id', 'mime_type'])
        .where('id', 'in', ids)
        .where('site_id', '=', siteId)
        .where('deleted_at', 'is', null)
        .orderBy('id')
        .forShare()
        .execute();

/** Live media assets of one site among `ids`, without a lock (read-only checks such as the publish pre-flight). */
export const findLiveMedia = (
  ids: readonly string[],
  siteId: string,
  executor: Kysely<DB> | Transaction<DB>,
) =>
  ids.length === 0
    ? Promise.resolve([])
    : executor
        .selectFrom('media_assets')
        .select(['id', 'mime_type'])
        .where('id', 'in', ids)
        .where('site_id', '=', siteId)
        .where('deleted_at', 'is', null)
        .execute();
