import type { AppAuthRuntime } from '../appAuth/runtime.js';
import { db } from '../db/index.js';
import { AppError } from '../helpers/appError.js';
import { hashPassword, verifyPassword } from '../helpers/password.js';
import { isUniqueViolation } from '../helpers/pgErrors.js';
import type { AppUserPrincipal, Principal } from '../permissions/types.js';
import * as appUsersRepository from '../repositories/appUsers.js';
import type { ActorContext, ClientInfo, SiteActorContext, SiteRef } from './actorContext.js';
import { normalizeEmail } from './adminUsers.js';
import { requestRegistrationAttemptNotice } from './appAuthNotices.js';
import {
  assertCanSignIn,
  endAllSignIns,
  issueSession,
  toAppUserView,
  type AppSession,
  type AppUserView,
} from './appAuthSessions.js';
import { consumeLink, isLinkConfigured, linkNotConfigured, requestLink } from './appUserLinks.js';
import { deleteAppUserInTransaction } from './appUsers.js';
import { recordAudit } from './audit.js';

/** App-user account flows behind /api/app-auth (ADR 0005, build plan §4.I2). No HTTP objects here. */

const invalidCredentials = () => new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');

export const requireAppUserPrincipal = (principal: Principal): AppUserPrincipal => {
  if (principal.kind !== 'appUser') {
    throw new AppError(401, 'UNAUTHENTICATED', 'Sign in with an app-user access token');
  }
  return principal;
};

const appUserActor = (context: SiteActorContext, appUserId: string): SiteActorContext => ({
  ...context,
  actor: { kind: 'appUser', appUserId, siteId: context.site.id, roleIds: [] },
});

/**
 * Without required confirmation the caller is signed in at once. With it, the answer is the same whether or
 * not the address already had an account (`{ confirmationRequired: true }`), so sign-up cannot be used to
 * find out who has an account.
 */
export type RegisterResult =
  { confirmationRequired: false; user: AppUserView; session: AppSession } | { confirmationRequired: true };

const emailTaken = (cause: unknown) =>
  new AppError(409, 'EMAIL_TAKEN', 'An account with this email address already exists', undefined, { cause });

/** Creates the account; returns undefined when the address is taken (unique violation). */
const insertAccount = async (
  runtime: AppAuthRuntime,
  context: SiteActorContext,
  input: { email: string; passwordHash: string; name?: string; client: ClientInfo },
): Promise<RegisterResult | undefined> => {
  try {
    return await db.transaction().execute(async (trx) => {
      const user = await appUsersRepository.insert(
        {
          site_id: context.site.id,
          email: input.email,
          name: input.name?.trim() ?? '',
          password_hash: input.passwordHash,
          password_changed_at: new Date(),
        },
        trx,
      );
      if (isLinkConfigured(runtime.config, 'confirmation')) {
        await requestLink('confirmation', user, trx);
      }
      await recordAudit(trx, {
        ...appUserActor(context, user.id),
        action: 'app_user.register',
        target: { type: 'app_user', id: user.id },
        metadata: { method: 'password' },
      });
      if (runtime.config.requireEmailConfirmation) {
        return { confirmationRequired: true };
      }
      const session = await issueSession(runtime, user.id, { client: input.client }, trx);
      return { confirmationRequired: false, user: session.user, session };
    });
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
    if (!runtime.config.requireEmailConfirmation) {
      throw emailTaken(error);
    }
    return undefined;
  }
};

/**
 * The address already has an account and confirmation is required: nothing is created or changed, the
 * account's owner is told by email (unless it is blocked), and the caller gets the usual answer.
 */
const notifyExistingAccount = async (siteId: string, email: string): Promise<RegisterResult> => {
  await db.transaction().execute(async (trx) => {
    const existing = await appUsersRepository.findByEmailWithHash(siteId, email, trx);
    if (existing && existing.blocked_at === null) {
      await requestRegistrationAttemptNotice(existing.id, trx);
    }
  });
  return { confirmationRequired: true };
};

/**
 * Registers a password account. The password is hashed before anything else, so a taken address answers in
 * about the same time as a new one.
 */
export const register = async (
  runtime: AppAuthRuntime,
  context: SiteActorContext,
  input: { email: string; password: string; name?: string; client: ClientInfo },
): Promise<RegisterResult> => {
  const email = normalizeEmail(input.email);
  const passwordHash = await hashPassword(input.password);
  const created = await insertAccount(runtime, context, { ...input, email, passwordHash });
  return created ?? notifyExistingAccount(context.site.id, email);
};

/**
 * Checks credentials and signs in to the account with this address on the request's site (each site has its
 * own accounts). Unknown emails and OAuth-only accounts take the same time as a wrong password (dummy-hash
 * verification) and get the same error.
 */
export const login = async (
  runtime: AppAuthRuntime,
  site: SiteRef,
  input: { email: string; password: string; client: ClientInfo },
): Promise<AppSession> => {
  const user = await appUsersRepository.findByEmailWithHash(site.id, normalizeEmail(input.email));
  const valid = await verifyPassword(input.password, user?.password_hash ?? undefined);
  if (!user || !valid) {
    throw invalidCredentials();
  }
  assertCanSignIn(runtime, user);
  return db.transaction().execute(async (trx) => {
    await appUsersRepository.update(user.id, { last_login_at: new Date() }, trx);
    return issueSession(runtime, user.id, { client: input.client }, trx);
  });
};

export const getMe = async (principal: Principal): Promise<AppUserView> => {
  const { appUserId } = requireAppUserPrincipal(principal);
  const summary = await appUsersRepository.findSummaryById(appUserId);
  if (!summary) {
    throw new AppError(401, 'UNAUTHENTICATED', 'This account no longer exists');
  }
  return toAppUserView(summary);
};

export const updateMe = async (principal: Principal, input: { name: string }): Promise<AppUserView> => {
  const { appUserId } = requireAppUserPrincipal(principal);
  await appUsersRepository.update(appUserId, { name: input.name.trim() });
  return getMe(principal);
};

/** Verifies the current password (when the account has one) against the locked row. */
const assertPassword = async (hash: string | null, password: string | undefined) => {
  if (hash === null) {
    return;
  }
  if (password === undefined || !(await verifyPassword(password, hash))) {
    throw new AppError(403, 'INVALID_PASSWORD', 'The current password is incorrect');
  }
};

/**
 * Changes (or, for an OAuth-only account, sets) the password. Every other sign-in is revoked; the caller
 * gets a fresh session.
 */
export const changePassword = async (
  runtime: AppAuthRuntime,
  context: ActorContext,
  input: { currentPassword?: string; newPassword: string; client: ClientInfo },
): Promise<AppSession> => {
  const { appUserId } = requireAppUserPrincipal(context.actor);
  const passwordHash = await hashPassword(input.newPassword);
  return db.transaction().execute(async (trx) => {
    const user = await appUsersRepository.lockById(appUserId, trx);
    if (!user) {
      throw new AppError(401, 'UNAUTHENTICATED', 'This account no longer exists');
    }
    await assertPassword(user.password_hash, input.currentPassword);
    const now = new Date();
    await appUsersRepository.update(user.id, { password_hash: passwordHash, password_changed_at: now }, trx);
    await endAllSignIns(user.id, now, 'password_change', trx);
    await recordAudit(trx, {
      ...context,
      action: 'app_user.password_change',
      target: { type: 'app_user', id: user.id },
    });
    return issueSession(runtime, user.id, { client: input.client }, trx);
  });
};

/** Deletes the caller's own account; needs the current password when the account has one. */
export const deleteMe = async (context: ActorContext, input: { password?: string }): Promise<void> => {
  const { appUserId } = requireAppUserPrincipal(context.actor);
  await db.transaction().execute(async (trx) => {
    const user = await appUsersRepository.lockById(appUserId, trx);
    if (!user) {
      throw new AppError(401, 'UNAUTHENTICATED', 'This account no longer exists');
    }
    await assertPassword(user.password_hash, input.password);
    await deleteAppUserInTransaction(context, user, trx);
  });
};

/** Confirms the address a confirmation link was sent to (a link of the request's site). */
export const confirmEmail = async (context: SiteActorContext, token: string): Promise<void> => {
  await db.transaction().execute(async (trx) => {
    const user = await consumeLink('confirmation', token, context.site.id, trx);
    if (user.confirmed_at === null) {
      await appUsersRepository.update(user.id, { confirmed_at: new Date() }, trx);
    }
    await recordAudit(trx, {
      ...appUserActor(context, user.id),
      action: 'app_user.confirm_email',
      target: { type: 'app_user', id: user.id },
    });
  });
};

/** Sends a new confirmation link to the site's account. Says nothing about whether the account exists. */
export const resendConfirmationByEmail = async (
  runtime: AppAuthRuntime,
  site: SiteRef,
  rawEmail: string,
): Promise<void> => {
  if (!isLinkConfigured(runtime.config, 'confirmation')) {
    throw linkNotConfigured('confirmation');
  }
  const user = await appUsersRepository.findByEmailWithHash(site.id, normalizeEmail(rawEmail));
  if (!user || user.confirmed_at !== null || user.blocked_at !== null) {
    return;
  }
  await db.transaction().execute((trx) => requestLink('confirmation', user, trx));
};

/** Starts a password reset for the site's account. Says nothing about whether the account exists. */
export const requestPasswordReset = async (
  runtime: AppAuthRuntime,
  context: SiteActorContext,
  rawEmail: string,
): Promise<void> => {
  if (!isLinkConfigured(runtime.config, 'reset')) {
    throw linkNotConfigured('reset');
  }
  const user = await appUsersRepository.findByEmailWithHash(context.site.id, normalizeEmail(rawEmail));
  if (!user || user.blocked_at !== null) {
    return;
  }
  await db.transaction().execute(async (trx) => {
    await requestLink('reset', user, trx);
    await recordAudit(trx, {
      ...context,
      action: 'app_user.password_reset_request',
      target: { type: 'app_user', id: user.id },
    });
  });
};

/**
 * Sets a new password from a reset link. The link works once and every sign-in of the account is revoked.
 * Following the link proves the address, so an unconfirmed account becomes confirmed.
 */
export const confirmPasswordReset = async (
  context: SiteActorContext,
  input: { token: string; password: string },
): Promise<void> => {
  const passwordHash = await hashPassword(input.password);
  await db.transaction().execute(async (trx) => {
    const user = await consumeLink('reset', input.token, context.site.id, trx);
    const now = new Date();
    await appUsersRepository.update(
      user.id,
      {
        password_hash: passwordHash,
        password_changed_at: now,
        ...(user.confirmed_at === null ? { confirmed_at: now } : {}),
      },
      trx,
    );
    await endAllSignIns(user.id, now, 'password_reset', trx);
    await recordAudit(trx, {
      ...appUserActor(context, user.id),
      action: 'app_user.password_reset',
      target: { type: 'app_user', id: user.id },
    });
  });
};
