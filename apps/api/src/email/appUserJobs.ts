import type { AppAuthConfig } from '../config/index.js';
import { PermanentJobError, type JobHandler } from '../jobs/types.js';
import {
  APP_USER_REGISTRATION_ATTEMPT_EMAIL_JOB,
  deliverRegistrationAttemptNotice,
} from '../services/appAuthNotices.js';
import {
  APP_USER_CONFIRMATION_EMAIL_JOB,
  APP_USER_PASSWORD_RESET_EMAIL_JOB,
  deliverLink,
} from '../services/appUserLinks.js';
import type { EmailDeliveryDependencies } from './delivery.js';

const readId = (payload: unknown, key: string): string => {
  const value =
    typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>)[key] : undefined;
  if (typeof value !== 'string') {
    throw new PermanentJobError(`Job payload is missing "${key}"`);
  }
  return value;
};

/** Job handlers for app-user emails (email confirmation, password reset, sign-up attempt notice). */
export const createAppUserEmailJobHandlers = (
  deps: EmailDeliveryDependencies & { appAuth: AppAuthConfig },
): [string, JobHandler][] => [
  [
    APP_USER_CONFIRMATION_EMAIL_JOB,
    ({ payload }) => deliverLink('confirmation', readId(payload, 'linkId'), deps),
  ],
  [APP_USER_PASSWORD_RESET_EMAIL_JOB, ({ payload }) => deliverLink('reset', readId(payload, 'linkId'), deps)],
  [
    APP_USER_REGISTRATION_ATTEMPT_EMAIL_JOB,
    ({ payload }) => deliverRegistrationAttemptNotice(readId(payload, 'appUserId'), deps),
  ],
];
