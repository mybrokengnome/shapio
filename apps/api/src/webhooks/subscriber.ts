import type { OutboxSubscriber } from '../jobs/types.js';
import * as sitesRepository from '../repositories/sites.js';
import * as webhooksRepository from '../repositories/webhooks.js';
import { matchesEvent } from './catalogue.js';
import { enqueueDelivery } from './enqueue.js';

/** The site an event is about, as the body names it (`null` for a network event). */
const siteOf = async (siteId: string | null, trx: Parameters<OutboxSubscriber>[1]) => {
  if (siteId === null) {
    return null;
  }
  const site = await sitesRepository.findById(siteId, trx);
  return site ? { id: site.id, key: site.key } : null;
};

/**
 * The webhook dispatcher: for each outbox event (relayed in order, one transaction per event, ADR 0007),
 * a delivery and a delivery job for every enabled webhook subscribed to it, in the relay's transaction. A
 * site's webhooks get that site's events; network webhooks get every site's (sites plan §H). The body
 * names the site.
 */
export const webhookOutboxSubscriber: OutboxSubscriber = async (event, trx) => {
  const webhooks = (await webhooksRepository.listEnabled(event.site_id, trx)).filter((webhook) =>
    matchesEvent(webhook.events, event.type),
  );
  if (webhooks.length === 0) {
    return;
  }
  const site = await siteOf(event.site_id, trx);
  for (const webhook of webhooks) {
    await enqueueDelivery(trx, {
      webhook,
      eventId: event.event_id,
      body: {
        id: event.event_id,
        type: event.type,
        createdAt: event.created_at.toISOString(),
        site,
        data: event.payload,
      },
    });
  }
};
