import type { OutboxSubscriber } from '../jobs/types.js';
import * as webhooksRepository from '../repositories/webhooks.js';
import { matchesEvent } from './catalogue.js';
import { enqueueDelivery } from './enqueue.js';

/**
 * The webhook dispatcher: for each outbox event (relayed in order, one transaction per event, ADR 0007),
 * a delivery and a delivery job for every enabled webhook subscribed to it, in the relay's transaction.
 */
export const webhookOutboxSubscriber: OutboxSubscriber = async (event, trx) => {
  const webhooks = (await webhooksRepository.listEnabled(trx)).filter((webhook) =>
    matchesEvent(webhook.events, event.type),
  );
  for (const webhook of webhooks) {
    await enqueueDelivery(trx, {
      webhook,
      eventId: event.event_id,
      body: {
        id: event.event_id,
        type: event.type,
        createdAt: event.created_at.toISOString(),
        data: event.payload,
      },
    });
  }
};
