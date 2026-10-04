import type { Kysely, Transaction } from 'kysely';
import type { DB } from '../db/types.js';
import * as sitesRepository from '../repositories/sites.js';

/** Site IDs to keys, so schema issues found in one site's view can name the site. */
export const loadSiteKeys = async (executor: Kysely<DB> | Transaction<DB>): Promise<Map<string, string>> =>
  new Map((await sitesRepository.list(executor)).map((site) => [site.id, site.key]));
