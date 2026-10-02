import type { Transaction } from 'kysely';
import type { DB } from '../db/types.js';

/**
 * Removing a locale's content (the `purgeLocale` follow-up after a locale is deleted). Media references
 * belong to package G's table; they are per head, so a locale's go with its heads.
 */
export const removeMediaReferencesForLocale = (locale: string, trx: Transaction<DB>) =>
  trx.deleteFrom('media_references').where('locale', '=', locale).executeTakeFirst();
