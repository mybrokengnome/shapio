import {
  sql,
  type Insertable,
  type Kysely,
  type Selectable,
  type Transaction,
  type Updateable,
} from 'kysely';
import { db } from '../db/index.js';
import type { DB, DeploymentConnections } from '../db/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

export type DeploymentConnectionRow = Selectable<DeploymentConnections>;

export const list = (trx: Executor = db) =>
  trx.selectFrom('deployment_connections').selectAll().orderBy('created_at').execute();

export const findById = (id: string, trx: Executor = db) =>
  trx.selectFrom('deployment_connections').selectAll().where('id', '=', id).executeTakeFirst();

/** Enabled connections whose trigger policy includes `trigger` (for the outbox subscriber). */
export const listTriggeredBy = (trigger: string, trx: Executor = db) =>
  trx
    .selectFrom('deployment_connections')
    .select(['id', 'debounce_seconds'])
    .where('enabled', '=', true)
    .where(sql<boolean>`${trigger} = any(trigger_policy)`)
    .execute();

/** The first enabled connection with a preview URL template (the default for the Preview button). */
export const findFirstWithPreview = (trx: Executor = db) =>
  trx
    .selectFrom('deployment_connections')
    .selectAll()
    .where('enabled', '=', true)
    .where('preview_url_template', 'is not', null)
    .orderBy('created_at')
    .limit(1)
    .executeTakeFirst();

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
    .set({ ...changes, version: sql<number>`version + 1`, updated_at: now })
    .where('id', '=', id)
    .$if(expectedVersion !== undefined, (qb) => qb.where('version', '=', expectedVersion ?? 0))
    .returningAll()
    .executeTakeFirst();

export const deleteById = (id: string, trx: Executor = db) =>
  trx.deleteFrom('deployment_connections').where('id', '=', id).executeTakeFirst();
