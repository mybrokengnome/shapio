import type { Kysely, Transaction } from 'kysely';
import { db } from '../db/index.js';
import type { DB } from '../db/types.js';
import { appUserSiteOf } from './appUsers.js';

type Executor = Kysely<DB> | Transaction<DB>;

/** The account a provider identity signs into on one site (identities are per site). */
export const findByIdentity = (
  siteId: string,
  provider: string,
  providerUserId: string,
  trx: Executor = db,
) =>
  trx
    .selectFrom('app_oauth_accounts')
    .selectAll()
    .where('site_id', '=', siteId)
    .where('provider', '=', provider)
    .where('provider_user_id', '=', providerUserId)
    .executeTakeFirst();

export const insert = (
  account: { appUserId: string; provider: string; providerUserId: string; email: string | null },
  trx: Executor = db,
) =>
  trx
    .insertInto('app_oauth_accounts')
    .values({
      app_user_id: account.appUserId,
      site_id: appUserSiteOf(trx, account.appUserId),
      provider: account.provider,
      provider_user_id: account.providerUserId,
      email: account.email,
    })
    .returning('id')
    .executeTakeFirstOrThrow();

export const updateEmail = (id: string, email: string | null, trx: Executor = db) =>
  trx.updateTable('app_oauth_accounts').set({ email, updated_at: new Date() }).where('id', '=', id).execute();

export const deleteForUser = (appUserId: string, trx: Executor = db) =>
  trx.deleteFrom('app_oauth_accounts').where('app_user_id', '=', appUserId).execute();
