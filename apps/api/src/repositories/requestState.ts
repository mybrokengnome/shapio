import type { Kysely, Transaction } from 'kysely';
import { db } from '../db/index.js';
import type { DB } from '../db/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

/** Which site a request is about: by ID (the credential's site), by key (the site it names) or the primary. */
export type SiteLookup = { by: 'id'; id: string } | { by: 'key'; key: string } | { by: 'primary' };

export type RequestStateRow = {
  schemaVersion: number;
  permissionsVersion: number;
  /** The looked-up site; undefined when none matches or no lookup was asked for. */
  site: { id: string; key: string } | undefined;
};

/**
 * Everything a request checks before its work, in one statement: the durable schema and permissions versions
 * (`system_versions`, one row) and, when asked, the request's site. Read once per request on the pool, before
 * any transaction; caches compare against these versions for the rest of the request.
 */
export const read = async (lookup: SiteLookup | undefined, trx: Executor = db): Promise<RequestStateRow> => {
  if (!lookup) {
    const row = await trx
      .selectFrom('system_versions')
      .select(['schema_version', 'permissions_version'])
      .executeTakeFirstOrThrow();
    return {
      schemaVersion: row.schema_version,
      permissionsVersion: row.permissions_version,
      site: undefined,
    };
  }
  const row = await trx
    .selectFrom('system_versions')
    .leftJoin('sites', (join) => {
      switch (lookup.by) {
        case 'id':
          return join.on('sites.id', '=', lookup.id);
        case 'key':
          return join.on('sites.key', '=', lookup.key);
        case 'primary':
          return join.on('sites.is_primary', '=', true);
      }
    })
    .select([
      'system_versions.schema_version',
      'system_versions.permissions_version',
      'sites.id as site_id',
      'sites.key as site_key',
    ])
    .executeTakeFirstOrThrow();
  return {
    schemaVersion: row.schema_version,
    permissionsVersion: row.permissions_version,
    site: row.site_id !== null && row.site_key !== null ? { id: row.site_id, key: row.site_key } : undefined,
  };
};
