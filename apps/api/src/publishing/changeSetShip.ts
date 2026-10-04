import type { Transaction } from 'kysely';
import { JOB_PRIORITY } from '../constants/jobPriorities.js';
import { CHANGE_SET_EVENTS, PUBLICATION_JOB_MAX_ATTEMPTS, PUBLISHING_JOBS } from '../constants/publishing.js';
import type { DB } from '../db/types.js';
import { ensureQueuedRun } from '../deployments/runs.js';
import { AppError } from '../helpers/appError.js';
import { writeOutboxEvent } from '../jobs/outbox.js';
import { enqueueJob } from '../jobs/queue.js';
import * as changeSetItemsRepository from '../repositories/changeSetItems.js';
import type { ChangeSetItemRow } from '../repositories/changeSetItems.js';
import * as changeSetsRepository from '../repositories/changeSets.js';
import type { ChangeSetRow } from '../repositories/changeSets.js';
import * as deploymentConnectionsRepository from '../repositories/deploymentConnections.js';
import * as deploymentRunsRepository from '../repositories/deploymentRuns.js';
import { createSeqAllocator, type SeqAllocator } from '../repositories/publications.js';
import * as schemaChangeJobsRepository from '../repositories/schemaChangeJobs.js';
import { readSnapshot } from '../schema/loadSnapshot.js';
import { activateDefinitions, type ActivationItem } from '../schema/planner/activate.js';
import { actorColumns } from '../schema/planner/actor.js';
import { discardStaged, type HandlerDeps } from '../schema/planner/changeJob.js';
import type { ChangePlan } from '../schema/planner/plan.js';
import { auditChangeSet, type ChangeSetServiceContext } from '../services/changeSets.js';
import { changeSetNotFound } from '../services/changeSetViews.js';
import { publicationItemsOf, type ShipPlan } from './changeSetPrepare.js';
import { describePublicationError } from './failures.js';
import { adminIdOf, tokenIdOf } from './principals.js';
import {
  PublicationItemError,
  runPublicationBatchInTransaction,
  type PublicationResult,
} from './publicationBatch.js';

/**
 * The final step of shipping a change set (developer-face plan §5): ONE transaction that activates the
 * set's schema items (`activateDefinitions`, with the prerequisite re-checks and content rewrites of items
 * prepared by the job), publishes and unpublishes its entry items against the schema that just became
 * active (`afterFlip`), takes the ONE publication sequence number they all share, and records the set as
 * shipped with its outbox event and audit row. A set without schema items runs the same content half in a
 * transaction of its own. If anything fails, nothing of the set is live.
 */
export type FinalizeInput = {
  changeSetId: string;
  entryItems: readonly ChangeSetItemRow[];
  /** Activation items (schema half); empty for a content-only set. */
  activation: ActivationItem[];
  expectedDraftVersions: ReadonlyMap<string, number>;
  /** Whether this step may still finish the set as it is now (status and owning job). */
  owns: (row: ChangeSetRow) => boolean;
  /** Scheduled ships publish the latest drafts and log the ones that changed after review. */
  logChangedAfterReview?: boolean;
};

/**
 * Scheduled ships publish the latest drafts (plan §5): each entry item whose draft version moved since it
 * was added or the set was scheduled gets an `item.changedAfterReview` timeline row, in the ship's
 * transaction (so it exists exactly when the ship does).
 */
const logChangedAfterReview = async (
  context: ChangeSetServiceContext,
  trx: Transaction<DB>,
  changeSetId: string,
  entryItems: readonly ChangeSetItemRow[],
) => {
  const heads = await changeSetItemsRepository.findHeadsForEntries(
    entryItems.flatMap((item) => (item.entry_id ? [item.entry_id] : [])),
    trx,
  );
  for (const item of entryItems) {
    const reviewed = (item.ship_state as { reviewedDraftVersion?: unknown } | null)?.reviewedDraftVersion;
    const draft = heads.find(
      (head) => head.entry_id === item.entry_id && head.locale === item.locale && head.state === 'draft',
    );
    if (typeof reviewed === 'number' && draft && draft.version !== reviewed) {
      await auditChangeSet(trx, context, changeSetId, 'change_set.item_changed_after_review', {
        itemId: item.id,
        entryId: item.entry_id,
        locale: item.locale,
        fromVersion: reviewed,
        toVersion: draft.version,
      });
    }
  }
};

export class ShipAlreadyHandled extends Error {
  constructor(readonly status: string) {
    super(`The change set is ${status}`);
    this.name = 'ShipAlreadyHandled';
  }
}

const lockShippable = async (trx: Transaction<DB>, input: FinalizeInput) => {
  const row = await changeSetsRepository.lockById(input.changeSetId, trx);
  if (!row) {
    throw changeSetNotFound(input.changeSetId);
  }
  if (!input.owns(row)) {
    throw new ShipAlreadyHandled(row.status);
  }
  return row;
};

/** Ship with deploy (option A): a run of the set's connection, after the set is live. */
const queueDeploy = async (trx: Transaction<DB>, row: ChangeSetRow, now: Date) => {
  if (!row.deployment_connection_id) {
    return null;
  }
  // A set deploys through a connection of its own site.
  const connection = await deploymentConnectionsRepository.findOnSite(
    row.site_id,
    row.deployment_connection_id,
    trx,
  );
  if (!connection?.enabled) {
    return null;
  }
  const { run } = await ensureQueuedRun(trx, {
    connectionId: connection.id,
    debounceSeconds: 0,
    trigger: 'change_set',
    createdBy: row.created_by,
    now,
  });
  await deploymentRunsRepository.setChangeSet(run.id, row.id, trx);
  return run.id;
};

const markShipped = async (
  context: ChangeSetServiceContext,
  trx: Transaction<DB>,
  row: ChangeSetRow,
  outcome: { seq: number; schemaVersion: number | null; results: PublicationResult[]; schemaItems: number },
) => {
  const now = new Date();
  await changeSetItemsRepository.setStatusAll(row.id, 'done', trx);
  await changeSetItemsRepository.clearShipState(row.id, trx);
  const runId = await queueDeploy(trx, row, now);
  await changeSetsRepository.update(
    row.id,
    {
      status: 'shipped',
      ship_phase: null,
      shipped_at: now,
      shipped_seq: String(outcome.seq),
      schema_version_after: outcome.schemaVersion,
      error: null,
      schedule_job_id: null,
      ...(runId ? { deployment_run_id: runId } : {}),
    },
    now,
    trx,
  );
  await writeOutboxEvent(trx, {
    type: CHANGE_SET_EVENTS.shipped,
    aggregateType: 'change_set',
    aggregateId: row.id,
    siteId: row.site_id,
    payload: {
      changeSetId: row.id,
      title: row.title,
      snapshot: outcome.seq,
      schemaVersion: outcome.schemaVersion,
      schemaItems: outcome.schemaItems,
      items: outcome.results.map(({ entryId, locale, action }) => ({ entryId, locale, action })),
    },
  });
  await auditChangeSet(trx, context, row.id, 'change_set.ship', {
    title: row.title,
    snapshot: outcome.seq,
    schemaVersion: outcome.schemaVersion,
    entryItems: outcome.results.length,
    schemaItems: outcome.schemaItems,
    deploymentRunId: runId,
  });
};

/** The content half and the bookkeeping, inside the final transaction. */
const shipContent = async (
  context: ChangeSetServiceContext,
  trx: Transaction<DB>,
  input: FinalizeInput,
  half: { seq: SeqAllocator; schemaVersion: number | null },
) => {
  const row = await lockShippable(trx, input);
  if (input.logChangedAfterReview) {
    await logChangedAfterReview(context, trx, row.id, input.entryItems);
  }
  // After a schema flip, the set's site's view of the schema that just became active.
  const snapshot =
    half.schemaVersion === null ? context.snapshot : (await readSnapshot(trx)).forSite(context.site.id);
  const results =
    input.entryItems.length === 0
      ? []
      : await runPublicationBatchInTransaction(
          { ...context, snapshot },
          trx,
          publicationItemsOf(input.entryItems, input.expectedDraftVersions),
          'change_set',
          half.seq,
        );
  const seq = await half.seq.next();
  await markShipped(context, trx, row, {
    seq,
    schemaVersion: half.schemaVersion,
    results,
    schemaItems: input.activation.length,
  });
};

export const finalizeShip = async (context: ChangeSetServiceContext, input: FinalizeInput): Promise<void> => {
  const { changeSetId } = input;
  if (input.activation.length > 0) {
    await activateDefinitions(context.db, {
      items: input.activation,
      actor: context.actor,
      changeSetId,
      siteId: context.site.id,
      ...(context.requestId ? { requestId: context.requestId } : {}),
      ...(context.ip ? { ip: context.ip } : {}),
      afterFlip: (trx, flipped) =>
        shipContent(context, trx, input, {
          seq: flipped.activation.seq,
          schemaVersion: flipped.schemaVersion,
        }),
    });
    return;
  }
  await context.db.transaction().execute((trx) =>
    shipContent(context, trx, input, {
      seq: createSeqAllocator(trx, context.site.id, {
        source: 'change_set',
        changeSetId,
        actor: actorColumns(context.actor),
      }),
      schemaVersion: null,
    }),
  );
};

/**
 * Starts the job that runs a set's prerequisites and finishes the ship (interactive ships with
 * prerequisites); the set is `shipping`/`preparing` until it ends.
 */
export const startShipJob = async (
  context: ChangeSetServiceContext,
  trx: Transaction<DB>,
  ship: ShipPlan,
  expectedDraftVersions: ReadonlyMap<string, number>,
) => {
  const { job } = await enqueueJob(
    {
      type: PUBLISHING_JOBS.changeSetShip,
      payload: { changeSetId: ship.row.id, mode: 'interactive' },
      priority: JOB_PRIORITY.timeCritical,
      maxAttempts: PUBLICATION_JOB_MAX_ATTEMPTS,
    },
    trx,
  );
  await markShipping(context, trx, ship, { jobId: job.id, mode: 'interactive', expectedDraftVersions });
  return job.id;
};

/** Moves a set to `shipping` (prerequisites to run) and stores what the job needs to finish it. */
export const markShipping = async (
  context: ChangeSetServiceContext,
  trx: Transaction<DB>,
  ship: ShipPlan,
  options: {
    jobId: string;
    mode: 'interactive' | 'scheduled';
    expectedDraftVersions: ReadonlyMap<string, number>;
  },
) => {
  for (const [itemId, version] of options.expectedDraftVersions) {
    await changeSetItemsRepository.saveShipState(itemId, { expectedDraftVersion: version }, trx);
  }
  await changeSetsRepository.update(
    ship.row.id,
    {
      status: 'shipping',
      ship_phase: 'preparing',
      ship_job_id: options.jobId,
      ship_mode: options.mode,
      ship_requested_by: adminIdOf(context.actor),
      ship_requested_by_token: tokenIdOf(context.actor),
      error: null,
    },
    new Date(),
    trx,
  );
  await writeOutboxEvent(trx, {
    type: CHANGE_SET_EVENTS.shipping,
    aggregateType: 'change_set',
    aggregateId: ship.row.id,
    payload: { changeSetId: ship.row.id, title: ship.row.title },
    siteId: ship.row.site_id,
  });
  await auditChangeSet(trx, context, ship.row.id, 'change_set.shipping', {
    mode: options.mode,
    schemaItems: ship.schema.length,
    entryItems: ship.entryItems.length,
  });
};

/** A failed ship, recorded after everything rolled back: which item stopped it and why. */
export const recordShipFailure = async (
  context: ChangeSetServiceContext,
  changeSetId: string,
  failure: { code: string; message: string; itemId: string | null; details?: unknown },
  items: readonly Pick<ChangeSetItemRow, 'id'>[],
) => {
  await context.db.transaction().execute(async (trx) => {
    const row = await changeSetsRepository.lockById(changeSetId, trx);
    if (!row) {
      return;
    }
    await changeSetItemsRepository.setStatusAll(changeSetId, 'pending', trx);
    await changeSetItemsRepository.clearShipState(changeSetId, trx);
    if (failure.itemId && items.some((item) => item.id === failure.itemId)) {
      await changeSetItemsRepository.markFailed(changeSetId, failure.itemId, failure.message, trx);
    }
    await changeSetsRepository.update(
      changeSetId,
      {
        status: 'failed',
        ship_phase: null,
        ship_job_id: null,
        schedule_job_id: null,
        error: JSON.stringify(failure),
      },
      new Date(),
      trx,
    );
    await writeOutboxEvent(trx, {
      type: CHANGE_SET_EVENTS.failed,
      aggregateType: 'change_set',
      aggregateId: changeSetId,
      payload: { changeSetId, title: row.title, failedItemId: failure.itemId, error: failure.message },
      siteId: row.site_id,
    });
    await auditChangeSet(
      trx,
      context,
      changeSetId,
      'change_set.ship',
      { title: row.title, failedItemId: failure.itemId, error: failure.message, code: failure.code },
      'failure',
    );
  });
};

/** Errors an interactive ship reports as a refusal (409) instead of failing the set: nothing went wrong yet. */
const REFUSALS: ReadonlySet<string> = new Set([
  'CHANGE_SET_STALE',
  'SCHEMA_VERSION_CONFLICT',
  'SCHEMA_CHANGED',
  'SCHEMA_CHANGE_IN_PROGRESS',
]);

export const isRefusal = (error: unknown): boolean => error instanceof AppError && REFUSALS.has(error.code);

export type ShipFailure = { code: string; message: string; itemId: string | null; details?: unknown };

/** How a failure reads on the set: the error code, the admin-readable message and the item it names. */
export const shipFailureOf = (error: unknown): ShipFailure => {
  const details = error instanceof AppError ? error.details : undefined;
  return {
    code: error instanceof AppError ? error.code : 'SHIP_FAILED',
    message: describePublicationError(error),
    itemId: error instanceof PublicationItemError ? error.ref : null,
    ...(details !== undefined ? { details } : {}),
  };
};

/**
 * The schema half of a failed ship: the staged work of each pending change is released and the change is
 * marked failed, so its definition can change again. Stored content and the active schema are untouched.
 */
export const abandonPendingChanges = async (deps: HandlerDeps, changeSetId: string, failure: ShipFailure) => {
  for (const change of await schemaChangeJobsRepository.listInFlightForChangeSet(changeSetId, deps.db)) {
    await discardStaged(deps, (change.plan as unknown as ChangePlan).prerequisites);
    await schemaChangeJobsRepository.finish(
      change.id,
      { status: 'failed', error: failure, now: new Date() },
      deps.db,
    );
  }
};
