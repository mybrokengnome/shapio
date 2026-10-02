import {
  sql,
  type Insertable,
  type Kysely,
  type Selectable,
  type Transaction,
  type Updateable,
} from 'kysely';
import { db } from '../db/index.js';
import type { DB, WebhookDeliveries, Webhooks } from '../db/types.js';
import { beforeCursor, cursorAt, type KeysetCursor } from '../publishing/pagination.js';

type Executor = Kysely<DB> | Transaction<DB>;

export type WebhookRow = Selectable<Webhooks>;
export type WebhookDeliveryRow = Selectable<WebhookDeliveries>;

const WEBHOOK_COLUMNS = [
  'webhooks.id',
  'webhooks.name',
  'webhooks.url',
  'webhooks.events',
  'webhooks.enabled',
  'webhooks.allow_private_network',
  'webhooks.max_attempts',
  'webhooks.created_by',
  'webhooks.created_at',
  'webhooks.updated_at',
  'webhooks.version',
] as const;

/** Webhooks without their encrypted secret, with the newest delivery's status. */
const withLastDelivery = (trx: Executor) =>
  trx
    .selectFrom('webhooks')
    .select(WEBHOOK_COLUMNS)
    .select((eb) => [
      eb
        .selectFrom('webhook_deliveries')
        .select('status')
        .whereRef('webhook_deliveries.webhook_id', '=', 'webhooks.id')
        .orderBy('created_at', 'desc')
        .limit(1)
        .as('last_status'),
      eb
        .selectFrom('webhook_deliveries')
        .select('updated_at')
        .whereRef('webhook_deliveries.webhook_id', '=', 'webhooks.id')
        .orderBy('created_at', 'desc')
        .limit(1)
        .as('last_at'),
    ]);

export type WebhookSummaryRow = Awaited<ReturnType<typeof list>>[number];

export const list = (trx: Executor = db) => withLastDelivery(trx).orderBy('webhooks.created_at').execute();

export const findSummaryById = (id: string, trx: Executor = db) =>
  withLastDelivery(trx).where('webhooks.id', '=', id).executeTakeFirst();

/** With the encrypted secret: for delivery only. */
export const findById = (id: string, trx: Executor = db) =>
  trx.selectFrom('webhooks').selectAll().where('id', '=', id).executeTakeFirst();

export const listEnabled = (trx: Executor = db) =>
  trx.selectFrom('webhooks').select(['id', 'events', 'max_attempts']).where('enabled', '=', true).execute();

export const insert = (row: Insertable<Webhooks>, trx: Executor = db) =>
  trx.insertInto('webhooks').values(row).returning('id').executeTakeFirstOrThrow();

export const update = (
  id: string,
  changes: Updateable<Webhooks>,
  expectedVersion: number | undefined,
  now: Date,
  trx: Executor = db,
) =>
  trx
    .updateTable('webhooks')
    .set({ ...changes, version: sql<number>`version + 1`, updated_at: now })
    .where('id', '=', id)
    .$if(expectedVersion !== undefined, (qb) => qb.where('version', '=', expectedVersion ?? 0))
    .returning(['id', 'version'])
    .executeTakeFirst();

export const deleteById = (id: string, trx: Executor = db) =>
  trx.deleteFrom('webhooks').where('id', '=', id).executeTakeFirst();

// Deliveries -----------------------------------------------------------------------------------------

/** One delivery per (webhook, outbox event); returns undefined when it already exists. */
export const insertDelivery = (row: Insertable<WebhookDeliveries>, trx: Executor = db) =>
  trx
    .insertInto('webhook_deliveries')
    .values(row)
    .onConflict((oc) => oc.columns(['webhook_id', 'event_id']).where('event_id', 'is not', null).doNothing())
    .returningAll()
    .executeTakeFirst();

export const setDeliveryJob = (id: string, jobId: string, trx: Executor = db) =>
  trx.updateTable('webhook_deliveries').set({ job_id: jobId }).where('id', '=', id).execute();

export const findDelivery = (id: string, trx: Executor = db) =>
  trx.selectFrom('webhook_deliveries').selectAll().where('id', '=', id).executeTakeFirst();

export const listDeliveries = (
  webhookId: string,
  cursor: KeysetCursor | undefined,
  limit: number,
  trx: Executor = db,
) =>
  trx
    .selectFrom('webhook_deliveries')
    .selectAll()
    .select(cursorAt('webhook_deliveries.created_at').as('cursor_at'))
    .where('webhook_id', '=', webhookId)
    .$if(cursor !== undefined, (qb) =>
      qb.where(
        beforeCursor('webhook_deliveries.created_at', 'webhook_deliveries.id', cursor as KeysetCursor),
      ),
    )
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(limit)
    .execute();

/** Records one attempt's outcome (appending its summary to the log) and the delivery's new status. */
export const recordAttempt = (
  id: string,
  outcome: {
    status: 'retrying' | 'succeeded' | 'dead';
    attempts: number;
    responseStatus: number | null;
    error: string | null;
    summary: unknown;
    now: Date;
  },
  trx: Executor = db,
) =>
  trx
    .updateTable('webhook_deliveries')
    .set({
      status: outcome.status,
      attempts: outcome.attempts,
      last_response_status: outcome.responseStatus,
      last_error: outcome.error,
      attempt_log: sql`attempt_log || ${JSON.stringify([outcome.summary])}::jsonb`,
      updated_at: outcome.now,
      ...(outcome.status === 'succeeded' ? { delivered_at: outcome.now } : {}),
    })
    .where('id', '=', id)
    .execute();

export const markDeliveryDead = (id: string, error: string, now: Date, trx: Executor = db) =>
  trx
    .updateTable('webhook_deliveries')
    .set({ status: 'dead', last_error: error, updated_at: now })
    .where('id', '=', id)
    .where('status', 'in', ['pending', 'retrying'])
    .execute();
