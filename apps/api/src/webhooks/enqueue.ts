import type { Kysely, Transaction } from 'kysely';
import { PUBLISHING_JOBS } from '../constants/publishing.js';
import type { DB } from '../db/types.js';
import { enqueueJob } from '../jobs/queue.js';
import * as webhooksRepository from '../repositories/webhooks.js';

type Executor = Kysely<DB> | Transaction<DB>;

/** The JSON body every delivery sends. Stored on the delivery so every attempt signs the same bytes. */
export type WebhookBody = { id: string; type: string; createdAt: string; data: unknown };

/**
 * Creates a delivery and its job in the caller's transaction. With an `eventId` the delivery is unique per
 * (webhook, event), so a re-dispatched outbox event never sends twice. Returns undefined for a duplicate.
 */
export const enqueueDelivery = async (
  trx: Executor,
  input: {
    webhook: { id: string; max_attempts: number };
    eventId: string | null;
    body: WebhookBody;
    isTest?: boolean;
  },
) => {
  const delivery = await webhooksRepository.insertDelivery(
    {
      webhook_id: input.webhook.id,
      event_id: input.eventId,
      event_type: input.body.type,
      payload: JSON.stringify(input.body),
      is_test: input.isTest ?? false,
    },
    trx,
  );
  if (!delivery) {
    return undefined;
  }
  const { job } = await enqueueJob(
    {
      type: PUBLISHING_JOBS.webhookDeliver,
      payload: { deliveryId: delivery.id },
      maxAttempts: input.webhook.max_attempts,
      idempotencyKey: `webhook-delivery:${delivery.id}`,
    },
    trx,
  );
  await webhooksRepository.setDeliveryJob(delivery.id, job.id, trx);
  return { ...delivery, job_id: job.id };
};
