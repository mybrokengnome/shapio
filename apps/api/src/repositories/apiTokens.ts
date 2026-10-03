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

export const list = (trx: Executor = db) => withRole(trx).orderBy('api_tokens.created_at', 'desc').execute();

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

export const revoke = async (id: string, now: Date, trx: Executor = db): Promise<boolean> => {
  const result = await trx
    .updateTable('api_tokens')
    .set({ revoked_at: now, updated_at: now })
    .where('id', '=', id)
    .where('revoked_at', 'is', null)
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
};

/** Revoked tokens hold no permissions; they are removed with the role they referenced. */
export const deleteRevokedForRole = (roleId: string, trx: Executor = db) =>
  trx.deleteFrom('api_tokens').where('role_id', '=', roleId).where('revoked_at', 'is not', null).execute();
