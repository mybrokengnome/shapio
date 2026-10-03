import type { Insertable, Kysely, Selectable, Transaction, Updateable } from 'kysely';
import { db } from '../db/index.js';
import { containsInsensitive } from '../db/sql/text.js';
import { timestampCursorText, timestampParam } from '../db/sql/time.js';
import { asBoolean } from '../db/sql/typed.js';
import { emptyArray, sortedArrayAgg } from '../db/sql/values.js';
import type { AppUsers, DB } from '../db/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

export type AppUserRow = Selectable<AppUsers>;
export type NewAppUser = Insertable<AppUsers>;

/** Public columns: everything except the password hash. */
const USER_COLUMNS = [
  'app_users.id',
  'app_users.email',
  'app_users.name',
  'app_users.confirmed_at',
  'app_users.blocked_at',
  'app_users.last_login_at',
  'app_users.created_at',
  'app_users.updated_at',
] as const;

export type AppUserSummary = Pick<
  AppUserRow,
  'id' | 'email' | 'name' | 'confirmed_at' | 'blocked_at' | 'last_login_at' | 'created_at' | 'updated_at'
> & { role_ids: string[]; has_password: boolean; providers: string[] };

const summaries = (trx: Executor) =>
  trx
    .selectFrom('app_users')
    .select(USER_COLUMNS)
    .select((eb) => [
      eb.fn
        .coalesce(
          eb
            .selectFrom('app_user_roles')
            .select(sortedArrayAgg<string>('role_id').as('ids'))
            .whereRef('app_user_roles.app_user_id', '=', 'app_users.id'),
          emptyArray<string>('uuid'),
        )
        .as('role_ids'),
      eb.fn
        .coalesce(
          eb
            .selectFrom('app_oauth_accounts')
            .select(sortedArrayAgg<string>('provider', { distinct: true }).as('providers'))
            .whereRef('app_oauth_accounts.app_user_id', '=', 'app_users.id'),
          emptyArray<string>('text'),
        )
        .as('providers'),
      asBoolean(eb('app_users.password_hash', 'is not', null)).as('has_password'),
    ])
    .where('app_users.deleted_at', 'is', null);

/**
 * Keyset cursor: the (created_at, id) of the last row of the previous page; `createdAt` is ISO-8601 with
 * microseconds so rows created within one millisecond are neither skipped nor repeated.
 */
export type AppUserCursor = { createdAt: string; id: string };

/** One site's accounts, newest first, optionally matching `search` in the email or name (case-insensitive). */
export const listPage = (
  {
    siteId,
    search,
    cursor,
    limit,
  }: { siteId: string; search: string | undefined; cursor: AppUserCursor | undefined; limit: number },
  trx: Executor = db,
) =>
  summaries(trx)
    .where('app_users.site_id', '=', siteId)
    .select(timestampCursorText('app_users.created_at').as('cursor_at'))
    .$if(search !== undefined, (qb) =>
      qb.where((eb) =>
        eb.or([
          containsInsensitive(eb.ref('app_users.email'), search ?? ''),
          containsInsensitive(eb.ref('app_users.name'), search ?? ''),
        ]),
      ),
    )
    .$if(cursor !== undefined, (qb) => {
      const at = timestampParam(cursor?.createdAt ?? null);
      return qb.where((eb) =>
        eb.or([
          eb('app_users.created_at', '<', at),
          eb.and([eb('app_users.created_at', '=', at), eb('app_users.id', '<', cursor?.id ?? '')]),
        ]),
      );
    })
    .orderBy('app_users.created_at', 'desc')
    .orderBy('app_users.id', 'desc')
    .limit(limit)
    .execute();

export const findSummaryById = (id: string, trx: Executor = db): Promise<AppUserSummary | undefined> =>
  summaries(trx).where('app_users.id', '=', id).executeTakeFirst();

/** An account of one site (another site's account reads as not found). */
export const findSummaryByIdInSite = (
  id: string,
  siteId: string,
  trx: Executor = db,
): Promise<AppUserSummary | undefined> =>
  summaries(trx).where('app_users.id', '=', id).where('app_users.site_id', '=', siteId).executeTakeFirst();

/**
 * The live account with this address on one site (email is unique per site). Includes the password hash:
 * for credential checks only.
 */
export const findByEmailWithHash = (siteId: string, email: string, trx: Executor = db) =>
  trx
    .selectFrom('app_users')
    .selectAll()
    .where('site_id', '=', siteId)
    .where((eb) => eb(eb.fn<string>('lower', ['email']), '=', email.toLowerCase()))
    .where('deleted_at', 'is', null)
    .executeTakeFirst();

/** Includes the password hash: for credential checks only. Live (not deleted) accounts only. */
export const findByIdWithHash = (id: string, trx: Executor = db) =>
  trx
    .selectFrom('app_users')
    .selectAll()
    .where('id', '=', id)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();

/** Locks the live account row (status changes, deletion and credential changes serialise on it). */
export const lockById = (id: string, trx: Transaction<DB>) =>
  trx
    .selectFrom('app_users')
    .selectAll()
    .where('id', '=', id)
    .where('deleted_at', 'is', null)
    .forUpdate()
    .executeTakeFirst();

/** Locks the live account row of one site (another site's account reads as not found). */
export const lockByIdInSite = (id: string, siteId: string, trx: Transaction<DB>) =>
  trx
    .selectFrom('app_users')
    .selectAll()
    .where('id', '=', id)
    .where('site_id', '=', siteId)
    .where('deleted_at', 'is', null)
    .forUpdate()
    .executeTakeFirst();

/**
 * Share-locks the live account while tokens are issued for it: a concurrent block or deletion (which takes
 * the row lock and bumps the permissions version) then commits after the token's version is read, so the
 * new token is re-validated on its first request instead of being trusted.
 */
export const lockForShare = (id: string, trx: Transaction<DB>) =>
  trx
    .selectFrom('app_users')
    .selectAll()
    .where('id', '=', id)
    .where('deleted_at', 'is', null)
    .forShare()
    .executeTakeFirst();

/**
 * Everything an access-token check needs in one round trip: the permissions version and the account's token
 * version (null when the account is gone or deleted).
 */
export const findTokenState = async (
  appUserId: string,
  trx: Executor = db,
): Promise<{ permissionsVersion: number; tokenVersion: number | null }> => {
  const row = await trx
    .selectFrom('system_versions')
    .select('permissions_version')
    .select((eb) =>
      eb
        .selectFrom('app_users')
        .select('token_version')
        .where('id', '=', appUserId)
        .where('deleted_at', 'is', null)
        .as('token_version'),
    )
    .executeTakeFirstOrThrow();
  return { permissionsVersion: row.permissions_version, tokenVersion: row.token_version };
};

/** Moves the account's token version: every access token issued before it is rejected from now on. */
export const bumpTokenVersion = (id: string, trx: Executor = db) =>
  trx
    .updateTable('app_users')
    .set((eb) => ({ token_version: eb('token_version', '+', eb.lit(1)) }))
    .where('id', '=', id)
    .execute();

export const insert = (user: NewAppUser, trx: Executor = db) =>
  trx.insertInto('app_users').values(user).returningAll().executeTakeFirstOrThrow();

export const update = (id: string, changes: Updateable<AppUsers>, trx: Executor = db) =>
  trx
    .updateTable('app_users')
    .set({ ...changes, updated_at: new Date() })
    .where('id', '=', id)
    .executeTakeFirst();

/** Custom role IDs of an account (the built-in `authenticated` role is implicit and never stored). */
export const findRoleIds = async (appUserId: string, trx: Executor = db): Promise<string[]> =>
  (
    await trx
      .selectFrom('app_user_roles')
      .select('role_id')
      .where('app_user_id', '=', appUserId)
      .orderBy('role_id')
      .execute()
  ).map((row) => row.role_id);

export const replaceRoles = async (appUserId: string, roleIds: readonly string[], trx: Executor = db) => {
  await trx.deleteFrom('app_user_roles').where('app_user_id', '=', appUserId).execute();
  if (roleIds.length > 0) {
    await trx
      .insertInto('app_user_roles')
      .values(
        roleIds.map((roleId) => ({
          app_user_id: appUserId,
          role_id: roleId,
          site_id: appUserSiteOf(trx, appUserId),
        })),
      )
      .execute();
  }
};

/**
 * The app user's site as a subquery, for rows that carry a copy of it (role assignments, OAuth identities).
 * Pass the outer query's executor; the subquery is compiled into the outer statement.
 */
export const appUserSiteOf = (executor: Executor, appUserId: string) =>
  executor.selectFrom('app_users').select('app_users.site_id').where('app_users.id', '=', appUserId);

/**
 * Hard-deletes a site's soft-deleted app users (site deletion). Their roles, OAuth accounts, refresh tokens,
 * login codes, password resets and email confirmations cascade; entries they owned keep no owner.
 */
export const deleteSoftDeletedOfSite = (siteId: string, trx: Executor = db) =>
  trx.deleteFrom('app_users').where('site_id', '=', siteId).where('deleted_at', 'is not', null).execute();
