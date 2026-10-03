import type { Kysely, Transaction } from 'kysely';
import { db } from '../db/index.js';
import type { DB } from '../db/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

/** Who a binding applies to: anonymous callers (`public`) or every signed-in app user (`authenticated`). */
export type AppRoleAudience = 'public' | 'authenticated';

export type SiteAppRoleBinding = { site_id: string; audience: string; role_id: string };

/** Every binding on every site (the permission cache holds them all, like the grants). */
export const listAll = (trx: Executor = db): Promise<SiteAppRoleBinding[]> =>
  trx.selectFrom('site_app_roles').select(['site_id', 'audience', 'role_id']).execute();

export const listForSite = (siteId: string, trx: Executor = db): Promise<SiteAppRoleBinding[]> =>
  trx
    .selectFrom('site_app_roles')
    .select(['site_id', 'audience', 'role_id'])
    .where('site_id', '=', siteId)
    .orderBy('audience')
    .orderBy('role_id')
    .execute();

/** Replaces the roles bound to one audience on one site. */
export const replaceForAudience = async (
  siteId: string,
  audience: AppRoleAudience,
  roleIds: readonly string[],
  trx: Executor = db,
): Promise<void> => {
  await trx
    .deleteFrom('site_app_roles')
    .where('site_id', '=', siteId)
    .where('audience', '=', audience)
    .execute();
  if (roleIds.length > 0) {
    await trx
      .insertInto('site_app_roles')
      .values(roleIds.map((roleId) => ({ site_id: siteId, audience, role_id: roleId })))
      .execute();
  }
};
