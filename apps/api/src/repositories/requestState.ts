import type { JoinBuilder, Kysely, Transaction } from 'kysely';
import { DELIVERY_DESCRIPTOR_SETTING } from '../constants/delivery.js';
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

/** The site a lookup names, joined to the one `system_versions` row (at most one row matches). */
const siteJoin = (join: JoinBuilder<DB, 'system_versions' | 'sites'>, lookup: SiteLookup) => {
  switch (lookup.by) {
    case 'id':
      return join.on('sites.id', '=', lookup.id);
    case 'key':
      return join.on('sites.key', '=', lookup.key);
    case 'primary':
      return join.on('sites.is_primary', '=', true);
  }
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
    .leftJoin('sites', (join) => siteJoin(join, lookup))
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

/** What an in-process delivery call reads besides the request state (plan next-in-process §2). */
export type DeliveryStateRow = RequestStateRow & {
  /** The release the server last started with; null before a server of this release started. */
  release: string | null;
  /** The stored delivery descriptor (JSON text); null before a server of this release started. */
  descriptor: string | null;
  /** The token's revocation and expiry; null when no token was asked about or the token no longer exists. */
  token: { revokedAt: Date | null; expiresAt: Date | null } | null;
};

/**
 * The request state for an in-process delivery call, in the same one statement: the versions and the site,
 * plus the server's release and delivery descriptor, and (for a token already resolved) whether it is still
 * live, so a call is this statement and its read.
 */
export const readForDelivery = async (
  input: { site: SiteLookup; tokenId?: string },
  trx: Executor = db,
): Promise<DeliveryStateRow> => {
  const { tokenId } = input;
  const row = await trx
    .selectFrom('system_versions')
    .leftJoin('sites', (join) => siteJoin(join, input.site))
    .leftJoin('system_settings', (join) => join.on('system_settings.key', '=', DELIVERY_DESCRIPTOR_SETTING))
    .select([
      'system_versions.schema_version',
      'system_versions.permissions_version',
      'system_versions.release',
      'sites.id as site_id',
      'sites.key as site_key',
      'system_settings.value as descriptor',
    ])
    .$if(tokenId !== undefined, (query) =>
      query
        .leftJoin('api_tokens', (join) => join.on('api_tokens.id', '=', tokenId ?? ''))
        .select([
          'api_tokens.id as token_id',
          'api_tokens.revoked_at as token_revoked_at',
          'api_tokens.expires_at as token_expires_at',
        ]),
    )
    .executeTakeFirstOrThrow();
  return {
    schemaVersion: row.schema_version,
    permissionsVersion: row.permissions_version,
    site: row.site_id !== null && row.site_key !== null ? { id: row.site_id, key: row.site_key } : undefined,
    release: row.release,
    descriptor: row.descriptor,
    token:
      row.token_id === undefined || row.token_id === null
        ? null
        : { revokedAt: row.token_revoked_at ?? null, expiresAt: row.token_expires_at ?? null },
  };
};
