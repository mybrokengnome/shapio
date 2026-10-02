import { sql, type Insertable, type Kysely, type Selectable, type Transaction } from 'kysely';
import { db } from '../db/index.js';
import type { DB, DeploymentRuns } from '../db/types.js';
import { beforeCursor, cursorAt, type KeysetCursor } from '../publishing/pagination.js';

type Executor = Kysely<DB> | Transaction<DB>;

export type DeploymentRunRow = Selectable<DeploymentRuns>;

const RUN_COLUMNS = [
  'deployment_runs.id',
  'deployment_runs.connection_id',
  'deployment_runs.status',
  'deployment_runs.status_rank',
  'deployment_runs.trigger',
  'deployment_runs.snapshot_seq',
  'deployment_runs.schema_version',
  'deployment_runs.retry_of',
  'deployment_runs.provider_ref',
  'deployment_runs.log_url',
  'deployment_runs.site_url',
  'deployment_runs.error',
  'deployment_runs.timeline',
  'deployment_runs.job_id',
  'deployment_runs.triggered_at',
  'deployment_runs.finished_at',
  'deployment_runs.created_by',
  'deployment_runs.created_at',
  'deployment_runs.updated_at',
] as const;

/** Runs with their connection's name and provider, for views. */
const withConnection = (trx: Executor) =>
  trx
    .selectFrom('deployment_runs')
    .innerJoin('deployment_connections as c', 'c.id', 'deployment_runs.connection_id')
    .select(RUN_COLUMNS)
    .select(['c.name as connection_name', 'c.provider']);

export type RunWithConnectionRow = Awaited<ReturnType<typeof findViewById>> & {};

export const findViewById = (id: string, trx: Executor = db) =>
  withConnection(trx).where('deployment_runs.id', '=', id).executeTakeFirst();

export const findById = (id: string, trx: Executor = db) =>
  trx.selectFrom('deployment_runs').selectAll().where('id', '=', id).executeTakeFirst();

export const list = (
  filter: { connectionId?: string },
  cursor: KeysetCursor | undefined,
  limit: number,
  trx: Executor = db,
) =>
  withConnection(trx)
    .select(cursorAt('deployment_runs.created_at').as('cursor_at'))
    .$if(filter.connectionId !== undefined, (qb) =>
      qb.where('deployment_runs.connection_id', '=', filter.connectionId ?? ''),
    )
    .$if(cursor !== undefined, (qb) =>
      qb.where(beforeCursor('deployment_runs.created_at', 'deployment_runs.id', cursor as KeysetCursor)),
    )
    .orderBy('deployment_runs.created_at', 'desc')
    .orderBy('deployment_runs.id', 'desc')
    .limit(limit)
    .execute();

/** The newest run of each connection, and the deployed run with the highest snapshot (what is live). */
export const latestPerConnection = (connectionIds: readonly string[], trx: Executor = db) =>
  connectionIds.length === 0
    ? Promise.resolve([])
    : withConnection(trx)
        .where('deployment_runs.connection_id', 'in', connectionIds)
        .distinctOn('deployment_runs.connection_id')
        .orderBy('deployment_runs.connection_id')
        .orderBy('deployment_runs.created_at', 'desc')
        .execute();

export const currentPerConnection = (connectionIds: readonly string[], trx: Executor = db) =>
  connectionIds.length === 0
    ? Promise.resolve([])
    : withConnection(trx)
        .where('deployment_runs.connection_id', 'in', connectionIds)
        .where('deployment_runs.status', '=', 'deployed')
        .distinctOn('deployment_runs.connection_id')
        .orderBy('deployment_runs.connection_id')
        .orderBy(sql`deployment_runs.snapshot_seq desc nulls last`)
        .orderBy('deployment_runs.finished_at', 'desc')
        .execute();

/** Inserts a queued run unless one is already queued for the connection (coalescing). */
export const insertQueued = (row: Insertable<DeploymentRuns>, trx: Executor = db) =>
  trx
    .insertInto('deployment_runs')
    .values({ ...row, status: 'queued', status_rank: 0 })
    .onConflict((oc) => oc.column('connection_id').where('status', '=', 'queued').doNothing())
    .returningAll()
    .executeTakeFirst();

export const findQueued = (connectionId: string, trx: Executor = db) =>
  trx
    .selectFrom('deployment_runs')
    .selectAll()
    .where('connection_id', '=', connectionId)
    .where('status', '=', 'queued')
    .executeTakeFirst();

export const setJob = (id: string, jobId: string, trx: Executor = db) =>
  trx.updateTable('deployment_runs').set({ job_id: jobId }).where('id', '=', id).execute();

export const setSnapshot = (
  id: string,
  snapshot: { seq: number; schemaVersion: number },
  trx: Executor = db,
) =>
  trx
    .updateTable('deployment_runs')
    .set({ snapshot_seq: String(snapshot.seq), schema_version: snapshot.schemaVersion })
    .where('id', '=', id)
    .where('status', '=', 'queued')
    .execute();

export type RunTransition = {
  status: string;
  rank: number;
  event: unknown;
  terminal: boolean;
  providerRef?: string | undefined;
  logUrl?: string | undefined;
  siteUrl?: string | undefined;
  error?: string | undefined;
  now: Date;
};

/**
 * Moves a run forward. Applies only when the new state ranks higher than the current one, so a callback
 * that arrives late (e.g. "building" after "deployed") can never move a run backwards. Returns the updated
 * row, or undefined when the transition was stale.
 */
export const transition = (id: string, next: RunTransition, trx: Executor = db) =>
  trx
    .updateTable('deployment_runs')
    .set({
      status: next.status,
      status_rank: next.rank,
      timeline: sql`timeline || ${JSON.stringify([next.event])}::jsonb`,
      updated_at: next.now,
      ...(next.providerRef !== undefined ? { provider_ref: next.providerRef } : {}),
      ...(next.logUrl !== undefined ? { log_url: next.logUrl } : {}),
      ...(next.siteUrl !== undefined ? { site_url: next.siteUrl } : {}),
      ...(next.error !== undefined ? { error: next.error } : {}),
      ...(next.status === 'triggered' ? { triggered_at: next.now } : {}),
      ...(next.terminal ? { finished_at: next.now } : {}),
    })
    .where('id', '=', id)
    .where('status_rank', '<', next.rank)
    .returningAll()
    .executeTakeFirst();

/** Adds a timeline note without changing the state (e.g. "callback ignored: older than current state"). */
export const appendTimeline = (id: string, event: unknown, now: Date, trx: Executor = db) =>
  trx
    .updateTable('deployment_runs')
    .set({ timeline: sql`timeline || ${JSON.stringify([event])}::jsonb`, updated_at: now })
    .where('id', '=', id)
    .execute();

/** Records provider details (log URL, deployment ID) without a state change. */
export const setProviderDetails = async (
  id: string,
  details: { providerRef?: string | undefined; logUrl?: string | undefined; siteUrl?: string | undefined },
  trx: Executor = db,
) => {
  const changes = {
    ...(details.providerRef !== undefined ? { provider_ref: details.providerRef } : {}),
    ...(details.logUrl !== undefined ? { log_url: details.logUrl } : {}),
    ...(details.siteUrl !== undefined ? { site_url: details.siteUrl } : {}),
  };
  if (Object.keys(changes).length === 0) {
    return;
  }
  await trx.updateTable('deployment_runs').set(changes).where('id', '=', id).execute();
};

/** Links a run to the change set whose ship triggered it (shown on the set's timeline). */
export const setChangeSet = (id: string, changeSetId: string, trx: Executor = db) =>
  trx.updateTable('deployment_runs').set({ change_set_id: changeSetId }).where('id', '=', id).execute();
