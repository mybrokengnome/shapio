import type { Transaction } from 'kysely';
import type { DB } from '../db/types.js';

/**
 * Removing a locale's content (the `purgeLocale` follow-up after a locale is deleted). Media references
 * belong to package G's table; they are per head, so a locale's go with its heads.
 */
export const removeMediaReferencesForLocale = (locale: string, trx: Transaction<DB>) =>
  trx.deleteFrom('media_references').where('locale', '=', locale).executeTakeFirst();

/** The IDs of a site's soft-deleted entries, as a subquery. */
const deletedEntryIdsOfSite = (siteId: string, trx: Transaction<DB>) =>
  trx.selectFrom('entries').select('id').where('site_id', '=', siteId).where('deleted_at', 'is not', null);

/**
 * Hard-deletes a site's soft-deleted entries and everything that hangs off them, so the site row can go
 * (the site and entry foreign keys restrict). Order matters: publication log rows and heads reference
 * revisions, revisions reference entries. Unique values, media references, schedules, preview tokens,
 * change set items and health findings cascade from the entries; relation edges from the heads.
 */
export const purgeDeletedEntriesOfSite = async (siteId: string, trx: Transaction<DB>) => {
  await trx
    .deleteFrom('publication_log')
    .where('site_id', '=', siteId)
    .where('entry_id', 'in', deletedEntryIdsOfSite(siteId, trx))
    .execute();
  await trx
    .deleteFrom('entry_heads')
    .where('site_id', '=', siteId)
    .where('entry_id', 'in', deletedEntryIdsOfSite(siteId, trx))
    .execute();
  await trx
    .deleteFrom('relation_edges')
    .where('target_entry_id', 'in', deletedEntryIdsOfSite(siteId, trx))
    .execute();
  await trx
    .deleteFrom('content_revisions')
    .where('entry_id', 'in', deletedEntryIdsOfSite(siteId, trx))
    .execute();
  await trx.deleteFrom('entries').where('site_id', '=', siteId).where('deleted_at', 'is not', null).execute();
};
