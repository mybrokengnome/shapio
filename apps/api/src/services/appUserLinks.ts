import type { Transaction } from 'kysely';
import type { AppAuthConfig } from '../config/index.js';
import { APP_EMAIL_CONFIRMATION_TTL_MS, APP_PASSWORD_RESET_TTL_MS } from '../constants/appAuth.js';
import type { DB } from '../db/types.js';
import type { EmailDeliveryDependencies } from '../email/delivery.js';
import { appEmailConfirmationEmail, appPasswordResetEmail } from '../email/templates.js';
import type { EmailMessage } from '../email/types.js';
import { AppError } from '../helpers/appError.js';
import { generateToken, hashToken } from '../helpers/tokens.js';
import { enqueueJob } from '../jobs/queue.js';
import { siteMismatch } from '../permissions/sites.js';
import * as appUsersRepository from '../repositories/appUsers.js';
import type { AppUserRow } from '../repositories/appUsers.js';
import * as appUserTokensRepository from '../repositories/appUserTokens.js';
import type { AppUserTokenTable } from '../repositories/appUserTokens.js';

/**
 * Emailed single-use links for app users: email confirmation and password reset. The row is created in the
 * caller's transaction with a job; the job issues the token (so the plain token never sits in the jobs
 * table), stores its hash and emails `<configured page>#token=…` (the fragment never reaches a server log).
 */
export type AppUserLinkKind = 'confirmation' | 'reset';

type LinkDefinition = {
  table: AppUserTokenTable;
  job: string;
  ttlMs: number;
  pageUrl: (config: AppAuthConfig) => string | undefined;
  template: (input: { to: string; linkUrl: string; expiresAt: Date }) => EmailMessage;
  /** Whether the link still makes sense for the account when the email is about to be sent. */
  stillWanted: (user: AppUserRow, email: string) => boolean;
};

export const APP_USER_CONFIRMATION_EMAIL_JOB = 'email.appUserConfirmation';
export const APP_USER_PASSWORD_RESET_EMAIL_JOB = 'email.appUserPasswordReset';

const LINKS: Readonly<Record<AppUserLinkKind, LinkDefinition>> = {
  confirmation: {
    table: 'email_confirmations',
    job: APP_USER_CONFIRMATION_EMAIL_JOB,
    ttlMs: APP_EMAIL_CONFIRMATION_TTL_MS,
    pageUrl: (config) => config.confirmEmailUrl,
    template: appEmailConfirmationEmail,
    stillWanted: (user, email) => user.confirmed_at === null && user.email === email,
  },
  reset: {
    table: 'app_password_resets',
    job: APP_USER_PASSWORD_RESET_EMAIL_JOB,
    ttlMs: APP_PASSWORD_RESET_TTL_MS,
    pageUrl: (config) => config.resetPasswordUrl,
    template: appPasswordResetEmail,
    stillWanted: (user, email) => user.blocked_at === null && user.email === email,
  },
};

/** Whether this instance can send the link at all (the site's page for it is configured). */
export const isLinkConfigured = (config: AppAuthConfig, kind: AppUserLinkKind): boolean =>
  LINKS[kind].pageUrl(config) !== undefined;

export const linkNotConfigured = (kind: AppUserLinkKind) =>
  new AppError(
    409,
    'NOT_CONFIGURED',
    kind === 'confirmation'
      ? 'Email confirmation is not configured (APP_AUTH_CONFIRM_EMAIL_URL)'
      : 'Password reset is not configured (APP_AUTH_RESET_PASSWORD_URL)',
  );

/** Creates the link row and its email job in the caller's transaction. */
export const requestLink = async (
  kind: AppUserLinkKind,
  user: Pick<AppUserRow, 'id' | 'email'>,
  trx: Transaction<DB>,
): Promise<void> => {
  const definition = LINKS[kind];
  const row = await appUserTokensRepository.insert(
    definition.table,
    { appUserId: user.id, email: user.email, expiresAt: new Date(Date.now() + definition.ttlMs) },
    trx,
  );
  await enqueueJob({ type: definition.job, payload: { linkId: row.id } }, trx);
};

const invalidLink = () =>
  new AppError(400, 'INVALID_OR_EXPIRED_TOKEN', 'This link is invalid, expired or already used');

/**
 * Consumes a link token: locks the row, checks it is unused and unexpired and that the account still has the
 * address it was sent to, then marks every pending link of that kind for the account used. Returns the
 * locked account. A link of another site's account is refused (403 `SITE_MISMATCH`) and stays unused.
 */
export const consumeLink = async (
  kind: AppUserLinkKind,
  token: string,
  siteId: string,
  trx: Transaction<DB>,
): Promise<AppUserRow> => {
  const definition = LINKS[kind];
  const now = new Date();
  const row = await appUserTokensRepository.lockByTokenHash(definition.table, hashToken(token), trx);
  if (!row || row.used_at !== null || row.expires_at.getTime() <= now.getTime()) {
    throw invalidLink();
  }
  const user = await appUsersRepository.lockById(row.app_user_id, trx);
  if (!user || user.email !== row.email || user.blocked_at !== null) {
    throw invalidLink();
  }
  if (user.site_id !== siteId) {
    throw siteMismatch();
  }
  await appUserTokensRepository.consumeAllForUser(definition.table, user.id, now, trx);
  return user;
};

/** Job: issues the token and emails the link. A retry issues a fresh token and kills the previous one. */
export const deliverLink = async (
  kind: AppUserLinkKind,
  linkId: string,
  { database, transport, appAuth }: EmailDeliveryDependencies & { appAuth: AppAuthConfig },
): Promise<{ sent: boolean }> => {
  const definition = LINKS[kind];
  const pageUrl = definition.pageUrl(appAuth);
  const now = new Date();
  const row = await appUserTokensRepository.findById(definition.table, linkId, database);
  if (!pageUrl || !row || row.used_at !== null || row.expires_at.getTime() <= now.getTime()) {
    return { sent: false };
  }
  const user = await appUsersRepository.findByIdWithHash(row.app_user_id, database);
  if (!user || !definition.stillWanted(user, row.email)) {
    return { sent: false };
  }
  const token = generateToken();
  await appUserTokensRepository.setTokenHash(definition.table, row.id, hashToken(token), now, database);
  await transport.send(
    definition.template({
      to: row.email,
      linkUrl: `${pageUrl}#token=${encodeURIComponent(token)}`,
      expiresAt: row.expires_at,
    }),
  );
  return { sent: true };
};
