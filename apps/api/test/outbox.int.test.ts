import { afterEach, describe, expect, it } from 'vitest';
import { relayOutboxEvents, writeOutboxEvent, MAX_DISPATCH_ATTEMPTS } from '../src/jobs/outbox.js';
import { enqueueJob } from '../src/jobs/queue.js';
import type { OutboxSubscriber } from '../src/jobs/types.js';
import { silentLogger } from './helpers/silentLogger.js';
import { useTestDatabase } from './helpers/testDatabase.js';

describe('transactional outbox', () => {
  const database = useTestDatabase();

  afterEach(async () => {
    await database.current.db.deleteFrom('outbox_events').execute();
    await database.current.db.deleteFrom('jobs').execute();
  });

  const write = (type: string, aggregateId = 'entry-1') =>
    database.current.db
      .transaction()
      .execute((trx) =>
        writeOutboxEvent(trx, { type, aggregateType: 'entry', aggregateId, payload: { locale: 'en' } }),
      );

  it('keeps an event only if the domain transaction commits', async () => {
    const { db } = database.current;
    await expect(
      db.transaction().execute(async (trx) => {
        await writeOutboxEvent(trx, { type: 'entry.published', aggregateType: 'entry', aggregateId: 'x' });
        throw new Error('publish failed');
      }),
    ).rejects.toThrow('publish failed');
    expect(await db.selectFrom('outbox_events').selectAll().execute()).toEqual([]);
  });

  it('hands committed events to subscribers in order, in one transaction with their follow-up jobs', async () => {
    await write('entry.published', 'a');
    await write('entry.unpublished', 'b');
    const seen: string[] = [];
    const subscriber: OutboxSubscriber = async (event, trx) => {
      seen.push(event.type);
      await enqueueJob({ type: 'webhook.deliver', idempotencyKey: `webhook:${event.event_id}` }, trx);
    };

    const dispatched = await relayOutboxEvents({
      db: database.current.db,
      subscribers: [subscriber],
      log: silentLogger,
    });

    expect(dispatched).toBe(2);
    expect(seen).toEqual(['entry.published', 'entry.unpublished']);
    const jobs = await database.current.db.selectFrom('jobs').select('type').execute();
    expect(jobs).toHaveLength(2);
    const pending = await database.current.db
      .selectFrom('outbox_events')
      .where('dispatched_at', 'is', null)
      .execute();
    expect(pending).toEqual([]);
  });

  it('records a failing event and still dispatches the events behind it', async () => {
    await write('entry.published', 'poison');
    await write('entry.published', 'healthy');
    const subscriber: OutboxSubscriber = async (event, trx) => {
      await enqueueJob({ type: 'webhook.deliver', idempotencyKey: `job:${event.aggregate_id}` }, trx);
      if (event.aggregate_id === 'poison') {
        throw new Error('subscriber bug');
      }
    };

    const dispatched = await relayOutboxEvents({
      db: database.current.db,
      subscribers: [subscriber],
      log: silentLogger,
    });

    expect(dispatched).toBe(1);
    const rows = await database.current.db.selectFrom('outbox_events').selectAll().orderBy('id').execute();
    expect(rows[0]).toMatchObject({ aggregate_id: 'poison', dispatched_at: null, dispatch_attempts: 1 });
    expect(rows[0]?.last_dispatch_error).toContain('subscriber bug');
    expect(rows[1]?.dispatched_at).not.toBeNull();
    // The poison event's job was rolled back with it; the healthy one's committed.
    const jobs = await database.current.db.selectFrom('jobs').select('idempotency_key').execute();
    expect(jobs).toEqual([{ idempotency_key: 'job:healthy' }]);
  });

  it('stops retrying an event after MAX_DISPATCH_ATTEMPTS', async () => {
    await write('entry.published', 'poison');
    const failing: OutboxSubscriber = async () => {
      throw new Error('always');
    };
    for (let i = 0; i < MAX_DISPATCH_ATTEMPTS + 2; i += 1) {
      await relayOutboxEvents({ db: database.current.db, subscribers: [failing], log: silentLogger });
    }
    const [row] = await database.current.db.selectFrom('outbox_events').selectAll().execute();
    expect(row?.dispatch_attempts).toBe(MAX_DISPATCH_ATTEMPTS);
  });
});
