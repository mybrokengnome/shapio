import type { Transaction } from 'kysely';
import type { AppAuthConfig } from '../config/index.js';
import { db } from '../db/index.js';
import type { DB } from '../db/types.js';
import { AppError } from '../helpers/appError.js';
import * as appOAuthAccountsRepository from '../repositories/appOAuthAccounts.js';
import * as appRolesRepository from '../repositories/appRoles.js';
import * as appUsersRepository from '../repositories/appUsers.js';
import type { AppUserCursor, AppUserSummary } from '../repositories/appUsers.js';
import * as appUserTokensRepository from '../repositories/appUserTokens.js';
import * as permissionsVersionRepository from '../repositories/permissionsVersion.js';
import type { ActorContext } from './actorContext.js';
import { endAllSignIns } from './appAuthSessions.js';
import { isLinkConfigured, linkNotConfigured, requestLink } from './appUserLinks.js';
import { recordAudit } from './audit.js';

/** App users as administrators manage them (Users → App users). */

export type AdminAppUserView = {
  id: string;
  email: string;
  name: string;
  confirmed: boolean;
  blocked: boolean;
  hasPassword: boolean;
  providers: string[];
  roleIds: string[];
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const toAdminView = (row: AppUserSummary): AdminAppUserView => ({
  id: row.id,
  email: row.email,
  name: row.name,
  confirmed: row.confirmed_at !== null,
  blocked: row.blocked_at !== null,
  hasPassword: row.has_password,
  providers: row.providers,
  roleIds: row.role_ids,
  lastLoginAt: row.last_login_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const notFound = () => new AppError(404, 'NOT_FOUND', 'App user not found');

export type AppUserPage = { items: AdminAppUserView[]; nextCursor: string | null };

const encodeCursor = (cursor: AppUserCursor): string =>
  Buffer.from(JSON.stringify([cursor.createdAt, cursor.id]), 'utf8').toString('base64url');

const decodeCursor = (value: string): AppUserCursor => {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === 'string' &&
      !Number.isNaN(Date.parse(parsed[0])) &&
      typeof parsed[1] === 'string' &&
      /^[0-9a-f-]{36}$/i.test(parsed[1])
    ) {
      return { createdAt: parsed[0], id: parsed[1] };
    }
  } catch {
    // Fall through: a malformed cursor is the caller's mistake.
  }
  throw new AppError(400, 'INVALID_CURSOR', 'The cursor is not valid');
};

/** One page of app users, newest first, optionally searched by email or name. */
export const listAppUsers = async (options: {
  search?: string;
  cursor?: string;
  limit: number;
}): Promise<AppUserPage> => {
  const search = options.search?.trim() || undefined;
  const rows = await appUsersRepository.listPage({
    search,
    cursor: options.cursor ? decodeCursor(options.cursor) : undefined,
    limit: options.limit + 1,
  });
  const items = rows.slice(0, options.limit);
  const last = items.at(-1);
  return {
    items: items.map(toAdminView),
    nextCursor:
      rows.length > options.limit && last ? encodeCursor({ createdAt: last.cursor_at, id: last.id }) : null,
  };
};

export const getAppUser = async (id: string): Promise<AdminAppUserView> => {
  const row = await appUsersRepository.findSummaryById(id);
  if (!row) {
    throw notFound();
  }
  return toAdminView(row);
};

/** Custom app roles only: `public` and `authenticated` are never assigned, they apply implicitly. */
const assertAssignableAppRoles = async (roleIds: readonly string[], trx: Transaction<DB>) => {
  const unique = [...new Set(roleIds)];
  const roles = await appRolesRepository.findByIds(unique, trx);
  if (roles.length !== unique.length || roles.some((role) => role.is_system)) {
    throw new AppError(400, 'INVALID_ROLES', 'Roles must be existing custom app roles');
  }
  return unique;
};

export type UpdateAppUserInput = { blocked?: boolean; roleIds?: string[] };

/**
 * Blocks or unblocks an account and replaces its custom roles. Every change bumps the permissions version
 * in the same transaction, so access tokens issued earlier are re-checked on their next request: a blocked
 * account's tokens stop working at once, and role changes apply without waiting for a refresh.
 */
export const updateAppUser = async (
  context: ActorContext,
  id: string,
  input: UpdateAppUserInput,
): Promise<AdminAppUserView> =>
  db.transaction().execute(async (trx) => {
    const user = await appUsersRepository.lockById(id, trx);
    if (!user) {
      throw notFound();
    }
    const now = new Date();
    const audit = { ...context, target: { type: 'app_user', id } };
    if (input.blocked !== undefined && input.blocked !== (user.blocked_at !== null)) {
      await appUsersRepository.update(id, { blocked_at: input.blocked ? now : null }, trx);
      if (input.blocked) {
        await endAllSignIns(id, now, 'blocked', trx);
      }
      await recordAudit(trx, { ...audit, action: input.blocked ? 'app_user.block' : 'app_user.unblock' });
    }
    if (input.roleIds !== undefined) {
      const roleIds = await assertAssignableAppRoles(input.roleIds, trx);
      const before = await appUsersRepository.findRoleIds(id, trx);
      await appUsersRepository.replaceRoles(id, roleIds, trx);
      await recordAudit(trx, {
        ...audit,
        action: 'app_user.roles_change',
        metadata: { before, after: [...roleIds].sort() },
      });
    }
    await permissionsVersionRepository.bumpPermissionsVersion(trx);
    const view = await appUsersRepository.findSummaryById(id, trx);
    if (!view) {
      throw notFound();
    }
    return toAdminView(view);
  });

/**
 * Deletes an account (by an administrator or by its owner): soft delete with personal data scrubbed. The row
 * stays so audit events and content ownership keep pointing at something; the email becomes free again.
 */
export const deleteAppUserInTransaction = async (
  context: ActorContext,
  user: { id: string },
  trx: Transaction<DB>,
): Promise<void> => {
  const now = new Date();
  await appUsersRepository.update(
    user.id,
    {
      email: `deleted-${user.id}@deleted.invalid`,
      name: '',
      password_hash: null,
      deleted_at: now,
    },
    trx,
  );
  await appUsersRepository.replaceRoles(user.id, [], trx);
  await appOAuthAccountsRepository.deleteForUser(user.id, trx);
  await endAllSignIns(user.id, now, 'deleted', trx);
  await appUserTokensRepository.consumeAllForUser('email_confirmations', user.id, now, trx);
  await appUserTokensRepository.consumeAllForUser('app_password_resets', user.id, now, trx);
  await permissionsVersionRepository.bumpPermissionsVersion(trx);
  await recordAudit(trx, {
    ...context,
    action: 'app_user.delete',
    target: { type: 'app_user', id: user.id },
  });
};

export const deleteAppUser = async (context: ActorContext, id: string): Promise<void> => {
  await db.transaction().execute(async (trx) => {
    const user = await appUsersRepository.lockById(id, trx);
    if (!user) {
      throw notFound();
    }
    await deleteAppUserInTransaction(context, user, trx);
  });
};

/** Sends a new confirmation email to an unconfirmed account. */
export const resendConfirmation = async (
  context: ActorContext,
  config: AppAuthConfig,
  id: string,
): Promise<void> => {
  if (!isLinkConfigured(config, 'confirmation')) {
    throw linkNotConfigured('confirmation');
  }
  await db.transaction().execute(async (trx) => {
    const user = await appUsersRepository.lockById(id, trx);
    if (!user) {
      throw notFound();
    }
    if (user.confirmed_at !== null) {
      throw new AppError(409, 'ALREADY_CONFIRMED', 'This email address is already confirmed');
    }
    await requestLink('confirmation', user, trx);
    await recordAudit(trx, {
      ...context,
      action: 'app_user.confirmation_resend',
      target: { type: 'app_user', id },
    });
  });
};
