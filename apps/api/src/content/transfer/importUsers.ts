import type { Database } from '../../db/index.js';
import * as appRolesRepository from '../../repositories/appRoles.js';
import * as appUsersRepository from '../../repositories/appUsers.js';
import * as permissionsVersionRepository from '../../repositories/permissionsVersion.js';
import * as transferImportRepository from '../../repositories/transferImport.js';
import type { AppUserRecord } from './format.js';

/**
 * App users of an `--include-users` bundle: accounts keep their IDs (entries' owners point at them), their
 * argon2 password hashes (never a plain password) and OAuth links; custom roles are matched by key. An
 * account whose email another account on the target already uses is reported and skipped.
 */
export type UserImportError = { id: string; code: string; message: string };

export type UserBatchResult = { added: number; unchanged: number; errors: UserImportError[] };

export const importUserBatch = async (
  db: Database,
  users: readonly AppUserRecord[],
): Promise<UserBatchResult> => {
  const existing = await transferImportRepository.findAppUsers(
    users.map((user) => user.id),
    users.map((user) => user.email),
  );
  const roleIds = new Map(
    (await appRolesRepository.listRoles(db))
      .filter((role) => !role.is_system)
      .map((role) => [role.key, role.id]),
  );
  const result: UserBatchResult = { added: 0, unchanged: 0, errors: [] };
  const added = users.filter((user) => {
    if (existing.ids.has(user.id)) {
      result.unchanged += 1;
      return false;
    }
    const holder = existing.emails.get(user.email.toLowerCase());
    if (holder && holder !== user.id) {
      result.errors.push({
        id: user.id,
        code: 'EMAIL_TAKEN',
        message: `${user.email} belongs to another account`,
      });
      return false;
    }
    return true;
  });
  if (added.length === 0) {
    return result;
  }
  await db.transaction().execute(async (trx) => {
    for (const user of added) {
      await transferImportRepository.insertAppUser(user, trx);
      await appUsersRepository.replaceRoles(
        user.id,
        user.roleKeys.flatMap((key) => {
          const id = roleIds.get(key);
          return id ? [id] : [];
        }),
        trx,
      );
      for (const account of user.oauthAccounts) {
        await transferImportRepository.insertOAuthAccount({ appUserId: user.id, ...account }, trx);
      }
    }
    // Role assignments changed: tokens re-validate against the database (ADR 0005).
    await permissionsVersionRepository.bumpPermissionsVersion(trx);
  });
  result.added = added.length;
  return result;
};
