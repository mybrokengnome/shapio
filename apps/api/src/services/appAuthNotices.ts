import type { Transaction } from 'kysely';
import type { AppAuthConfig } from '../config/index.js';
import type { DB } from '../db/types.js';
import type { EmailDeliveryDependencies } from '../email/delivery.js';
import { appRegistrationAttemptEmail } from '../email/templates.js';
import { enqueueJob } from '../jobs/queue.js';
import * as appUsersRepository from '../repositories/appUsers.js';

/**
 * Notices emailed to app users that carry no token: the job payload only names the account, and the address
 * is read when the email is sent.
 */
export const APP_USER_REGISTRATION_ATTEMPT_EMAIL_JOB = 'email.appUserRegistrationAttempt';

/** Queues the "someone tried to sign up with your address" email, in the caller's transaction. */
export const requestRegistrationAttemptNotice = async (
  appUserId: string,
  trx: Transaction<DB>,
): Promise<void> => {
  await enqueueJob({ type: APP_USER_REGISTRATION_ATTEMPT_EMAIL_JOB, payload: { appUserId } }, trx);
};

/** Job: sends the notice unless the account is gone or blocked by then. */
export const deliverRegistrationAttemptNotice = async (
  appUserId: string,
  { database, transport, urls, appAuth }: EmailDeliveryDependencies & { appAuth: AppAuthConfig },
): Promise<{ sent: boolean }> => {
  const user = await appUsersRepository.findByIdWithHash(appUserId, database);
  if (!user || user.blocked_at !== null) {
    return { sent: false };
  }
  await transport.send(
    appRegistrationAttemptEmail({ to: user.email, siteUrl: appAuth.confirmEmailUrl ?? urls.publicUrl }),
  );
  return { sent: true };
};
