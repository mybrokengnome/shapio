import { CHANGE_SET_EVENTS } from '../constants/publishing.js';
import type { OutboxSubscriber } from '../jobs/types.js';
import * as deploymentConnectionsRepository from '../repositories/deploymentConnections.js';
import { ensureQueuedRun } from './runs.js';
import type { TriggerPolicy } from './types.js';

/** Which outbox events start a run, by trigger policy. Unpublishing and deleting live content change the site too. */
const policyFor = (event: { type: string; payload: unknown }): TriggerPolicy | undefined => {
  switch (event.type) {
    case 'entry.published':
    case 'entry.unpublished':
      return 'publish';
    case 'entry.deleted':
      return (event.payload as { wasPublished?: boolean } | null)?.wasPublished ? 'publish' : undefined;
    case CHANGE_SET_EVENTS.shipped:
      return 'change_set';
    case 'schema.activated':
    case 'schema.deleted':
      return 'schema';
    default:
      return undefined;
  }
};

/**
 * Deployment triggers from the outbox (ADR 0007): in the relay's transaction, every enabled connection whose
 * trigger policy matches gets a queued run (or joins the one already queued), so builds follow publishes
 * at least once and bursts coalesce.
 */
export const deploymentOutboxSubscriber: OutboxSubscriber = async (event, trx) => {
  const policy = policyFor(event);
  if (!policy) {
    return;
  }
  for (const connection of await deploymentConnectionsRepository.listTriggeredBy(policy, trx)) {
    await ensureQueuedRun(trx, {
      connectionId: connection.id,
      debounceSeconds: connection.debounce_seconds,
      trigger: policy,
      now: new Date(),
    });
  }
};
