import type { Insertable, Kysely, Selectable, Transaction, Updateable } from 'kysely';
import { db } from '../db/index.js';
import { jsonArrayAppend } from '../db/sql/json.js';
import type { DB, WebhookDeliveries, Webhooks } from '../db/types.js';
import { beforeCursor, cursorAt, type KeysetCursor } from '../publishing/pagination.js';

type Executor = Kysely<DB> | Transaction<DB>;

export type WebhookRow = Selectable<Webhooks>;
export type WebhookDeliveryRow = Selectable<WebhookDeliveries>;

const WEBHOOK_COLUMNS = [
  'webhooks.id',
  'webhooks.site_id',
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

/** Webhooks without their encrypted secret, with their site's key and the newest delivery's status. */
const withLastDelivery = (trx: Executor) =>
  trx
    .selectFrom('webhooks')
    .leftJoin('sites', 'sites.id', 'webhooks.site_id')
    .select(WEBHOOK_COLUMNS)
    .select('sites.key as site_key')
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

/**
 * Webhooks a site sees (sites plan §H): its own and the network ones (null site: every site's events).
 */
export const list = (siteId: string, trx: Executor = db) =>
  withLastDelivery(trx)
    .where((eb) => eb.or([eb('webhooks.site_id', 'is', null), eb('webhooks.site_id', '=', siteId)]))
    .orderBy('webhooks.created_at')
    .execute();

/** One webhook a site sees (its own or a network one); another site's reads as not found. */
export const findSummaryVisible = (siteId: string, id: string, trx: Executor = db) =>
  withLastDelivery(trx)
    .where('webhooks.id', '=', id)
    .where((eb) => eb.or([eb('webhooks.site_id', 'is', null), eb('webhooks.site_id', '=', siteId)]))
    .executeTakeFirst();

/** With the encrypted secret, by ID on any site: for delivery and imports. */
export const findById = (id: string, trx: Executor = db) =>
  trx.selectFrom('webhooks').selectAll().where('id', '=', id).executeTakeFirst();

/** With the encrypted secret, if the site sees it (its own or a network one). */
export const findVisible = (siteId: string, id: string, trx: Executor = db) =>
  trx
    .selectFrom('webhooks')
    .selectAll()
    .where('id', '=', id)
    .where((eb) => eb.or([eb('site_id', 'is', null), eb('site_id', '=', siteId)]))
    .executeTakeFirst();

/**
 * Enabled webhooks an event goes to: the network webhooks and those of the event's site; every webhook for
 * a network event (`siteId` null: a schema or locale change concerns every site).
 */
export const listEnabled = (siteId: string | null, trx: Executor = db) =>
  trx
    .selectFrom('webhooks')
    .select(['id', 'events', 'max_attempts'])
    .where('enabled', '=', true)
    .$if(siteId !== null, (qb) =>
      qb.where((eb) => eb.or([eb('site_id', 'is', null), eb('site_id', '=', siteId ?? '')])),
    )
    .execute();

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
    .set((eb) => ({ ...changes, version: eb('version', '+', eb.lit(1)), updated_at: now }))
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
      attempt_log: jsonArrayAppend('attempt_log', outcome.summary),
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
