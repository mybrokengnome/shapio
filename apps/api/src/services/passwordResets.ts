import { PASSWORD_RESET_TTL_MS } from '../constants/auth.js';
import { db } from '../db/index.js';
import { ADMIN_LINK_PATHS, tokenLink, type EmailDeliveryDependencies } from '../email/delivery.js';
import { passwordResetEmail } from '../email/templates.js';
import { AppError } from '../helpers/appError.js';
import { hashPassword } from '../helpers/password.js';
import { generateToken, hashToken } from '../helpers/tokens.js';
import { enqueueJob } from '../jobs/queue.js';
import * as adminSessionsRepository from '../repositories/adminSessions.js';
import * as adminUsersRepository from '../repositories/adminUsers.js';
import * as passwordResetsRepository from '../repositories/passwordResets.js';
import type { ActorContext } from './actorContext.js';
import { normalizeEmail } from './adminUsers.js';
import { recordAudit } from './audit.js';

export const PASSWORD_RESET_EMAIL_JOB = 'email.adminPasswordReset';

const invalidToken = () =>
  new AppError(400, 'INVALID_OR_EXPIRED_TOKEN', 'This reset link is invalid or has expired');

/**
 * Starts a reset for an active account. The response never says whether the account exists; the email
 * (with the single-use token) is produced by a job.
 */
export const requestPasswordReset = async (context: ActorContext, rawEmail: string): Promise<void> => {
  const user = await adminUsersRepository.findByEmailWithHash(normalizeEmail(rawEmail));
  if (!user || user.status !== 'active') {
    return;
  }
  await db.transaction().execute(async (trx) => {
    const now = new Date();
    const reset = await passwordResetsRepository.insert(
      { admin_user_id: user.id, expires_at: new Date(now.getTime() + PASSWORD_RESET_TTL_MS) },
      trx,
    );
    await enqueueJob({ type: PASSWORD_RESET_EMAIL_JOB, payload: { resetId: reset.id } }, trx);
    await recordAudit(trx, {
      ...context,
      action: 'auth.password_reset_request',
      target: { type: 'admin_user', id: user.id },
    });
  });
};

/** Sets a new password from a reset link. The link works once; every session of the account is revoked. */
export const confirmPasswordReset = async (
  context: ActorContext,
  input: { token: string; password: string },
): Promise<void> => {
  const passwordHash = await hashPassword(input.password);
  await db.transaction().execute(async (trx) => {
    const now = new Date();
    const reset = await passwordResetsRepository.lockByTokenHash(hashToken(input.token), trx);
    if (!reset || reset.used_at !== null || reset.expires_at.getTime() <= now.getTime()) {
      throw invalidToken();
    }
    const user = await adminUsersRepository.findByIdWithHash(reset.admin_user_id, trx);
    if (!user || user.status !== 'active') {
      throw invalidToken();
    }
    await adminUsersRepository.update(
      user.id,
      { password_hash: passwordHash, password_changed_at: now },
      trx,
    );
    await passwordResetsRepository.consumeAllForUser(user.id, now, trx);
    await adminSessionsRepository.revokeAllForUser(user.id, now, {}, trx);
    await recordAudit(trx, {
      ...context,
      action: 'auth.password_reset',
      target: { type: 'admin_user', id: user.id },
    });
  });
};

/** Job: issues the reset token and emails the link. A retry issues a fresh token and kills the previous one. */
export const deliverPasswordReset = async (
  resetId: string,
  { database, urls, transport }: EmailDeliveryDependencies,
): Promise<{ sent: boolean }> => {
  const now = new Date();
  const reset = await passwordResetsRepository.findById(resetId, database);
  if (!reset || reset.used_at !== null || reset.expires_at.getTime() <= now.getTime()) {
    return { sent: false };
  }
  const user = await adminUsersRepository.findByIdWithHash(reset.admin_user_id, database);
  if (!user || user.status !== 'active') {
    return { sent: false };
  }
  const token = generateToken();
  await passwordResetsRepository.setTokenHash(reset.id, hashToken(token), now, database);
  await transport.send(
    passwordResetEmail({
      to: user.email,
      instanceUrl: urls.absoluteUrl('/'),
      resetUrl: tokenLink(urls, ADMIN_LINK_PATHS.resetPassword, token),
      expiresAt: reset.expires_at,
    }),
  );
  return { sent: true };
};
