import type { Kysely, Transaction } from 'kysely';
import { db } from '../db/index.js';
import type { DB } from '../db/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

/**
 * Deletes of finished bookkeeping older than a cutoff, in bounded batches so a large backlog never holds
 * long locks. Each returns the number of rows removed by that batch. Only finished rows are eligible: dead
 * and pending jobs, and undispatched outbox events, are never touched.
 */
const deleted = (result: { numDeletedRows: bigint }) => Number(result.numDeletedRows);

export const pruneSucceededJobs = async (before: Date, limit: number, trx: Executor = db) =>
  deleted(
    await trx
      .deleteFrom('jobs')
      .where('id', 'in', (eb) =>
        eb
          .selectFrom('jobs')
          .select('id')
          .where('status', '=', 'succeeded')
          .where('finished_at', '<', before)
          .limit(limit),
      )
      .executeTakeFirstOrThrow(),
  );

export const pruneDispatchedOutboxEvents = async (before: Date, limit: number, trx: Executor = db) =>
  deleted(
    await trx
      .deleteFrom('outbox_events')
      .where('id', 'in', (eb) =>
        eb
          .selectFrom('outbox_events')
          .select('id')
          .where('dispatched_at', 'is not', null)
          .where('dispatched_at', '<', before)
          .limit(limit),
      )
      .executeTakeFirstOrThrow(),
  );

export const pruneExtensionHookRuns = async (before: Date, limit: number, trx: Executor = db) =>
  deleted(
    await trx
      .deleteFrom('extension_hook_runs')
      .where((eb) =>
        eb(
          eb.refTuple('event_id', 'hook'),
          'in',
          eb
            .selectFrom('extension_hook_runs')
            .select(['event_id', 'hook'])
            .where('completed_at', '<', before)
            .limit(limit)
            .$asTuple('event_id', 'hook'),
        ),
      )
      .executeTakeFirstOrThrow(),
  );

/** Health findings resolved before the cutoff (open findings are never pruned). */
export const pruneResolvedHealthFindings = async (before: Date, limit: number, trx: Executor = db) =>
  deleted(
    await trx
      .deleteFrom('content_health_findings')
      .where('id', 'in', (eb) =>
        eb
          .selectFrom('content_health_findings')
          .select('id')
          .where('resolved_at', 'is not', null)
          .where('resolved_at', '<', before)
          .limit(limit),
      )
      .executeTakeFirstOrThrow(),
  );

/** Presence rows of tabs that stopped sending heartbeats (reads ignore them already; this frees space). */
export const pruneStalePresence = async (before: Date, limit: number, trx: Executor = db) =>
  deleted(
    await trx
      .deleteFrom('editor_presence')
      .where('last_seen_at', '<', before)
      .where('entry_id', 'in', (eb) =>
        eb.selectFrom('editor_presence').select('entry_id').where('last_seen_at', '<', before).limit(limit),
      )
      .executeTakeFirstOrThrow(),
  );

/**
 * Dead jobs of one type that finished before a cutoff, with their payload, in id order after `afterId`
 * (keyset paging). Read only: dead jobs stay for an operator.
 */
export const listDeadJobs = (
  type: string,
  before: Date,
  afterId: string | null,
  limit: number,
  trx: Executor = db,
) =>
  trx
    .selectFrom('jobs')
    .select(['id', 'payload'])
    .where('type', '=', type)
    .where('status', '=', 'dead')
    .where('finished_at', '<', before)
    .$if(afterId !== null, (qb) => qb.where('id', '>', afterId as string))
    .orderBy('id')
    .limit(limit)
    .execute();

/** Credential tables whose rows stop working at `expires_at`. */
export const EXPIRING_CREDENTIAL_TABLES = [
  'app_refresh_tokens',
  'preview_tokens',
  'password_resets',
  'app_password_resets',
  'email_confirmations',
  'app_login_codes',
  'admin_sessions',
  'admin_invitations',
] as const;

export type ExpiringCredentialTable = (typeof EXPIRING_CREDENTIAL_TABLES)[number];

/**
 * Credentials that expired before the cutoff: they no longer authorise anything, and the retention period
 * keeps recently expired ones for looking into an incident.
 */
export const pruneExpiredCredentials =
  (table: ExpiringCredentialTable) =>
  async (before: Date, limit: number, trx: Executor = db) =>
    deleted(
      await trx
        .deleteFrom(table)
        .where('id', 'in', (eb) =>
          eb.selectFrom(table).select('id').where('expires_at', '<', before).limit(limit),
        )
        .executeTakeFirstOrThrow(),
    );

/** Setup tokens used or superseded before the cutoff (the live, unused one is never touched). */
export const pruneSpentSetupTokens = async (before: Date, limit: number, trx: Executor = db) =>
  deleted(
    await trx
      .deleteFrom('setup_tokens')
      .where('id', 'in', (eb) =>
        eb
          .selectFrom('setup_tokens')
          .select('id')
          .where((w) => w.or([w('used_at', '<', before), w('superseded_at', '<', before)]))
          .limit(limit),
      )
      .executeTakeFirstOrThrow(),
  );

/**
 * Finished webhook deliveries (succeeded or dead) created before the cutoff, except each webhook's newest
 * delivery, so the webhook still shows its last state. Pending and retrying deliveries are never touched.
 */
export const pruneFinishedWebhookDeliveries = async (before: Date, limit: number, trx: Executor = db) =>
  deleted(
    await trx
      .deleteFrom('webhook_deliveries')
      .where('id', 'in', (eb) =>
        eb
          .selectFrom('webhook_deliveries as d')
          .select('d.id')
          .where('d.status', 'in', ['succeeded', 'dead'])
          .where('d.created_at', '<', before)
          .where((w) =>
            w.exists(
              w
                .selectFrom('webhook_deliveries as newer')
                .select('newer.id')
                .whereRef('newer.webhook_id', '=', 'd.webhook_id')
                .where((w) =>
                  w.or([
                    w('newer.created_at', '>', w.ref('d.created_at')),
                    w.and([
                      w('newer.created_at', '=', w.ref('d.created_at')),
                      w('newer.id', '>', w.ref('d.id')),
                    ]),
                  ]),
                ),
            ),
          )
          .limit(limit),
      )
      .executeTakeFirstOrThrow(),
  );

/**
 * Finished deployment runs before the cutoff, except each connection's newest run (the run list's last state)
 * and its live one: the deployed run `currentPerConnection` picks (highest snapshot, nulls last, then latest
 * finish, then ID). A deployed run is only removed when another deployed run of its connection outranks it.
 */
export const pruneFinishedDeploymentRuns = async (before: Date, limit: number, trx: Executor = db) =>
  deleted(
    await trx
      .deleteFrom('deployment_runs')
      .where('id', 'in', (eb) =>
        eb
          .selectFrom('deployment_runs as r')
          .select('r.id')
          .where('r.finished_at', 'is not', null)
          .where('r.finished_at', '<', before)
          .where((w) =>
            w.exists(
              w
                .selectFrom('deployment_runs as newer')
                .select('newer.id')
                .whereRef('newer.connection_id', '=', 'r.connection_id')
                .where((w) =>
                  w.or([
                    w('newer.created_at', '>', w.ref('r.created_at')),
                    w.and([
                      w('newer.created_at', '=', w.ref('r.created_at')),
                      w('newer.id', '>', w.ref('r.id')),
                    ]),
                  ]),
                ),
            ),
          )
          .where((w) =>
            w.or([
              w('r.status', '!=', 'deployed'),
              w.exists(
                w
                  .selectFrom('deployment_runs as live')
                  .select('live.id')
                  .whereRef('live.connection_id', '=', 'r.connection_id')
                  .where('live.status', '=', 'deployed')
                  .where((o) =>
                    o.or([
                      o.and([o('live.snapshot_seq', 'is not', null), o('r.snapshot_seq', 'is', null)]),
                      o('live.snapshot_seq', '>', o.ref('r.snapshot_seq')),
                      o.and([
                        o.or([
                          o('live.snapshot_seq', '=', o.ref('r.snapshot_seq')),
                          o.and([o('live.snapshot_seq', 'is', null), o('r.snapshot_seq', 'is', null)]),
                        ]),
                        o.or([
                          o('live.finished_at', '>', o.ref('r.finished_at')),
                          o.and([
                            o('live.finished_at', '=', o.ref('r.finished_at')),
                            o('live.id', '>', o.ref('r.id')),
                          ]),
                        ]),
                      ]),
                    ]),
                  ),
              ),
            ]),
          )
          .limit(limit),
      )
      .executeTakeFirstOrThrow(),
  );
