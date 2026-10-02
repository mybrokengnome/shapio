import { PermanentJobError, type JobHandler } from '../jobs/types.js';
import { deliverInvitation, INVITATION_EMAIL_JOB } from '../services/invitations.js';
import { deliverPasswordReset, PASSWORD_RESET_EMAIL_JOB } from '../services/passwordResets.js';
import type { EmailDeliveryDependencies } from './delivery.js';

const readId = (payload: unknown, key: string): string => {
  const value =
    typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>)[key] : undefined;
  if (typeof value !== 'string') {
    throw new PermanentJobError(`Job payload is missing "${key}"`);
  }
  return value;
};

/** Job handlers for admin identity emails (invitations, password resets). */
export const createAdminEmailJobHandlers = (deps: EmailDeliveryDependencies): [string, JobHandler][] => [
  [
    INVITATION_EMAIL_JOB,
    ({ payload, attempt }) => deliverInvitation(readId(payload, 'invitationId'), attempt, deps),
  ],
  [PASSWORD_RESET_EMAIL_JOB, ({ payload }) => deliverPasswordReset(readId(payload, 'resetId'), deps)],
];
