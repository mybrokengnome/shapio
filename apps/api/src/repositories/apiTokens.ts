import type { Insertable, Kysely, Transaction } from 'kysely';
import { db } from '../db/index.js';
import type { ApiTokens, DB } from '../db/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

export type NewApiToken = Insertable<ApiTokens>;

const LIST_COLUMNS = [
  'api_tokens.id',
  'api_tokens.name',
  'api_tokens.token_prefix',
  'api_tokens.role_id',
  'api_tokens.created_by',
  'api_tokens.expires_at',
  'api_tokens.last_used_at',
  'api_tokens.revoked_at',
  'api_tokens.created_at',
  'api_tokens.site_id',
  'admin_roles.kind as role_kind',
] as const;

const withRole = (trx: Executor) =>
  trx
    .selectFrom('api_tokens')
    .innerJoin('admin_roles', 'admin_roles.id', 'api_tokens.role_id')
    .select(LIST_COLUMNS);

export const insert = (token: NewApiToken, trx: Executor = db) =>
  trx.insertInto('api_tokens').values(token).returning('id').executeTakeFirstOrThrow();

/** One site's tokens, plus network tokens (no site) when `includeNetwork` is set. Newest first. */
export const listForSite = (siteId: string, includeNetwork: boolean, trx: Executor = db) =>
  withRole(trx)
    .where((eb) =>
      includeNetwork
        ? eb.or([eb('api_tokens.site_id', '=', siteId), eb('api_tokens.site_id', 'is', null)])
        : eb('api_tokens.site_id', '=', siteId),
    )
    .orderBy('api_tokens.created_at', 'desc')
    .orderBy('api_tokens.id', 'desc')
    .execute();

export const findById = (id: string, trx: Executor = db) =>
  withRole(trx).where('api_tokens.id', '=', id).executeTakeFirst();

/** A usable token for this hash: not revoked. Expiry is checked by the caller. */
export const findLiveByHash = (tokenHash: string, trx: Executor = db) =>
  withRole(trx)
    .where('api_tokens.token_hash', '=', tokenHash)
    .where('api_tokens.revoked_at', 'is', null)
    .executeTakeFirst();

export const touchLastUsed = (id: string, now: Date, staleBefore: Date, trx: Executor = db) =>
  trx
    .updateTable('api_tokens')
    .set({ last_used_at: now })
    .where('id', '=', id)
    .where((eb) => eb.or([eb('last_used_at', 'is', null), eb('last_used_at', '<', staleBefore)]))
    .execute();

/**
 * Revokes a live token of one site, or a network token (no site) when `includeNetwork` is set. Another
 * site's token is left alone (false, as for an unknown token).
 */
export const revoke = async (
  id: string,
  scope: { siteId: string; includeNetwork: boolean },
  now: Date,
  trx: Executor = db,
): Promise<boolean> => {
  const result = await trx
    .updateTable('api_tokens')
    .set({ revoked_at: now, updated_at: now })
    .where('id', '=', id)
    .where('revoked_at', 'is', null)
    .where((eb) =>
      scope.includeNetwork
        ? eb.or([eb('site_id', '=', scope.siteId), eb('site_id', 'is', null)])
        : eb('site_id', '=', scope.siteId),
    )
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
};

/** Revoked tokens hold no permissions; they are removed with the role they referenced. */
export const deleteRevokedForRole = (roleId: string, trx: Executor = db) =>
  trx.deleteFrom('api_tokens').where('role_id', '=', roleId).where('revoked_at', 'is not', null).execute();
