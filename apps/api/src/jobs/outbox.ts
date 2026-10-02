import type { Kysely, Transaction } from 'kysely';
import type { DB } from '../db/types.js';
import { describeError } from '../helpers/errors.js';
import * as outboxEventsRepository from '../repositories/outboxEvents.js';
import type { JobLogger, OutboxSubscriber } from './types.js';

export type OutboxEventInput = {
  /** Catalogue name, e.g. `entry.published`, `schema.activated`. */
  type: string;
  aggregateType: string;
  aggregateId: string;
  payload?: Record<string, unknown>;
};

/** Events that fail dispatch this many times stop being retried and are left for an operator. */
export const MAX_DISPATCH_ATTEMPTS = 10;
const MAX_EVENTS_PER_PASS = 100;

/**
 * Records a domain event in the caller's transaction. It is dispatched only if that transaction commits,
 * and is never lost if it does (transactional outbox, ADR 0007).
 */
export const writeOutboxEvent = (trx: Transaction<DB>, event: OutboxEventInput) =>
  outboxEventsRepository.insert(
    {
      type: event.type,
      aggregate_type: event.aggregateType,
      aggregate_id: event.aggregateId,
      payload: JSON.stringify(event.payload ?? {}),
    },
    trx,
  );

type RelayOptions = {
  db: Kysely<DB>;
  subscribers: readonly OutboxSubscriber[];
  log: JobLogger;
  now?: () => Date;
};

/**
 * Dispatches pending outbox events in id order, one transaction per event: every subscriber runs in that
 * transaction, then the event is marked dispatched. A failing event is recorded and skipped for this pass,
 * so it cannot block the events behind it. Returns the number dispatched.
 */
export const relayOutboxEvents = async ({ db, subscribers, log, now = () => new Date() }: RelayOptions) => {
  const attempted: string[] = [];
  let dispatched = 0;
  while (attempted.length < MAX_EVENTS_PER_PASS) {
    let eventId: string | undefined;
    try {
      const outcome = await db.transaction().execute(async (trx) => {
        const event = await outboxEventsRepository.lockNextUndispatched(
          MAX_DISPATCH_ATTEMPTS,
          attempted,
          trx,
        );
        if (!event) {
          return 'empty' as const;
        }
        eventId = event.id;
        for (const subscriber of subscribers) {
          await subscriber(event, trx);
        }
        await outboxEventsRepository.markDispatched(event.id, now(), trx);
        return 'dispatched' as const;
      });
      if (outcome === 'empty') {
        break;
      }
      dispatched += 1;
    } catch (error) {
      if (eventId === undefined) {
        throw error;
      }
      log.error({ err: error, outboxEventId: eventId }, 'outbox event dispatch failed');
      await outboxEventsRepository.recordDispatchFailure(eventId, describeError(error), db);
    }
    if (eventId !== undefined) {
      attempted.push(eventId);
    }
  }
  return dispatched;
};
