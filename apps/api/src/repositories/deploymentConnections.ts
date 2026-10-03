import type { Insertable, Kysely, Selectable, Transaction, Updateable } from 'kysely';
import { db } from '../db/index.js';
import { arrayContains } from '../db/sql/values.js';
import type { DB, DeploymentConnections } from '../db/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

export type DeploymentConnectionRow = Selectable<DeploymentConnections>;

/** One site's connections (sites plan §H: deployments are per site). */
export const list = (siteId: string, trx: Executor = db) =>
  trx
    .selectFrom('deployment_connections')
    .selectAll()
    .where('site_id', '=', siteId)
    .orderBy('created_at')
    .orderBy('id')
    .execute();

/** By ID on any site: for jobs and callbacks, which start from a run or a signed callback. */
export const findById = (id: string, trx: Executor = db) =>
  trx.selectFrom('deployment_connections').selectAll().where('id', '=', id).executeTakeFirst();

/** By ID on one site: another site's connection reads as not found. */
export const findOnSite = (siteId: string, id: string, trx: Executor = db) =>
  trx
    .selectFrom('deployment_connections')
    .selectAll()
    .where('id', '=', id)
    .where('site_id', '=', siteId)
    .executeTakeFirst();

/**
 * Enabled connections whose trigger policy includes `trigger` (for the outbox subscriber): the event's site's
 * connections, or every site's for a network event (`siteId` null: a schema change builds every site).
 */
export const listTriggeredBy = (trigger: string, siteId: string | null, trx: Executor = db) =>
  trx
    .selectFrom('deployment_connections')
    .select(['id', 'debounce_seconds'])
    .where('enabled', '=', true)
    .where((eb) => arrayContains(eb.ref('trigger_policy'), trigger))
    .$if(siteId !== null, (qb) => qb.where('site_id', '=', siteId ?? ''))
    .execute();

/** The site's first enabled connection with a preview URL template (the default for the Preview button). */
export const findFirstWithPreview = (siteId: string, trx: Executor = db) =>
  trx
    .selectFrom('deployment_connections')
    .selectAll()
    .where('site_id', '=', siteId)
    .where('enabled', '=', true)
    .where('preview_url_template', 'is not', null)
    .orderBy('created_at')
    .orderBy('id')
    .limit(1)
    .executeTakeFirst();

/** Every site's enabled preview URL templates (the admin's CSP `frame-src`; services/previewOrigins.ts). */
export const listPreviewTemplates = (trx: Executor = db) =>
  trx
    .selectFrom('deployment_connections')
    .select('preview_url_template')
    .distinct()
    .where('enabled', '=', true)
    .where('preview_url_template', 'is not', null)
    .execute();

/** One site's enabled connections with a preview URL template (the entry form's preview targets). */
export const listWithPreview = (siteId: string, trx: Executor = db) =>
  trx
    .selectFrom('deployment_connections')
    .select(['id', 'name', 'preview_url_template'])
    .where('site_id', '=', siteId)
    .where('enabled', '=', true)
    .where('preview_url_template', 'is not', null)
    .orderBy('created_at')
    .orderBy('id')
    .execute();

export const insert = (row: Insertable<DeploymentConnections>, trx: Executor = db) =>
  trx.insertInto('deployment_connections').values(row).returningAll().executeTakeFirstOrThrow();

export const update = (
  id: string,
  changes: Updateable<DeploymentConnections>,
  expectedVersion: number | undefined,
  now: Date,
  trx: Executor = db,
) =>
  trx
    .updateTable('deployment_connections')
    .set((eb) => ({ ...changes, version: eb('version', '+', eb.lit(1)), updated_at: now }))
    .where('id', '=', id)
    .$if(expectedVersion !== undefined, (qb) => qb.where('version', '=', expectedVersion ?? 0))
    .returningAll()
    .executeTakeFirst();

export const deleteOnSite = (siteId: string, id: string, trx: Executor = db) =>
  trx
    .deleteFrom('deployment_connections')
    .where('id', '=', id)
    .where('site_id', '=', siteId)
    .executeTakeFirst();
