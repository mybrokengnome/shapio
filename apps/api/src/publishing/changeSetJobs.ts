import { PUBLISHING_JOBS } from '../constants/publishing.js';
import { createContentPorts } from '../content/ports.js';
import { PermanentJobError, type JobContext, type JobHandler } from '../jobs/types.js';
import * as changeSetItemsRepository from '../repositories/changeSetItems.js';
import * as changeSetsRepository from '../repositories/changeSets.js';
import type { ChangeSetRow } from '../repositories/changeSets.js';
import * as schemaChangeJobsRepository from '../repositories/schemaChangeJobs.js';
import * as schemaModelsRepository from '../repositories/schemaModels.js';
import type { ActivationItem } from '../schema/planner/activate.js';
import {
  applyContent,
  PrerequisiteFailure,
  runSteps,
  type HandlerDeps,
} from '../schema/planner/changeJob.js';
import type { ChangePlan } from '../schema/planner/plan.js';
import { readStoredDefinition } from '../schema/storedDefinition.js';
import type { ChangeSetServiceContext } from '../services/changeSets.js';
import { activationItemsOf, planShip, storedDraftVersions, writePendingChanges } from './changeSetPrepare.js';
import {
  abandonPendingChanges,
  finalizeShip,
  markShipping,
  recordShipFailure,
  ShipAlreadyHandled,
  shipFailureOf,
} from './changeSetShip.js';
import { isPermanentPublicationError } from './failures.js';
import { jobContentContext, type PublishingJobEnvironment } from './jobEnvironment.js';
import { loadActor } from './principals.js';

/**
 * `changeSet.ship`: a scheduled set at its time (checked and prepared like an interactive ship, without the
 * strict draft check: scheduled ships publish the latest drafts), or the prerequisites of a set that is
 * `shipping` (dry runs and index builds of every schema item, checkpointed per change), then the final
 * transaction. A failure that retrying cannot fix fails the set, releases staged work and leaves the schema
 * and content as they were.
 */
type ShipJobPayload = { changeSetId: string };

const isScheduledRun = (row: ChangeSetRow, jobId: string) =>
  row.status === 'scheduled' && row.schedule_job_id === jobId;

const isShippingRun = (row: ChangeSetRow, jobId: string) =>
  row.status === 'shipping' && row.ship_job_id === jobId;

const actorFor = (environment: PublishingJobEnvironment, row: ChangeSetRow, scheduled: boolean) =>
  loadActor(
    environment.runtime.db,
    scheduled
      ? {
          adminUserId: row.scheduled_by ?? (row.scheduled_by_token ? null : row.created_by),
          tokenId: row.scheduled_by_token,
        }
      : { adminUserId: row.ship_requested_by, tokenId: row.ship_requested_by_token },
    `change-set:${row.id}`,
  );

/** One job checkpoint holds each pending change's prerequisite progress, keyed by change ID. */
const checkpointIo = (job: JobContext, changeId: string) => {
  const all = () => (job.checkpoint ?? {}) as Record<string, unknown>;
  return {
    checkpoint: all()[changeId] ?? null,
    saveCheckpoint: async (value: unknown) => {
      const next = { ...all(), [changeId]: value };
      job.checkpoint = next;
      return job.saveCheckpoint(next);
    },
  };
};

/** Runs the prerequisites of every pending change of the set; returns their activation items. */
const prepareSchema = async (
  deps: HandlerDeps,
  changeSetId: string,
  job: JobContext,
): Promise<ActivationItem[]> => {
  const items: ActivationItem[] = [];
  for (const change of await schemaChangeJobsRepository.listInFlightForChangeSet(changeSetId, deps.db)) {
    const plan = change.plan as unknown as ChangePlan;
    await schemaChangeJobsRepository.markRunning(change.id, new Date(), deps.db);
    const checkpoint = await runSteps(deps, plan.prerequisites, job, checkpointIo(job, change.id));
    const revision = change.to_revision_id
      ? await schemaModelsRepository.findRevisionById(change.to_revision_id, deps.db)
      : undefined;
    items.push({
      plan,
      after: revision ? readStoredDefinition(revision.definition) : null,
      expectedVersion: plan.fromVersion,
      pending: {
        changeJobId: change.id,
        revisionId: revision?.id ?? null,
        version: revision?.version ?? null,
      },
      recheck: applyContent(deps, plan.prerequisites, checkpoint),
    });
  }
  return items;
};

const finishShipping = async (
  context: ChangeSetServiceContext,
  deps: HandlerDeps,
  row: ChangeSetRow,
  job: JobContext,
) => {
  const activation = await prepareSchema(deps, row.id, job);
  await changeSetsRepository.update(row.id, { ship_phase: 'activating' }, new Date(), deps.db);
  const entryItems = (await changeSetItemsRepository.listForSet(row.id, deps.db)).filter(
    (item) => item.kind === 'entry',
  );
  await finalizeShip(context, {
    changeSetId: row.id,
    entryItems,
    activation,
    expectedDraftVersions: storedDraftVersions(entryItems),
    owns: (current) => isShippingRun(current, job.id),
    logChangedAfterReview: row.ship_mode === 'scheduled',
  });
};

/** A scheduled set at its time: checked like an interactive ship (acknowledgements stored when scheduled). */
const shipScheduled = async (
  context: ChangeSetServiceContext,
  deps: HandlerDeps,
  row: ChangeSetRow,
  job: JobContext,
) => {
  const ship = await context.db.transaction().execute(async (trx) => {
    const locked = await changeSetsRepository.lockById(row.id, trx);
    if (!locked || !isScheduledRun(locked, job.id)) {
      throw new ShipAlreadyHandled(locked?.status ?? 'missing');
    }
    const planned = await planShip(
      context,
      locked,
      {
        acknowledgeBreaking: locked.acknowledge_breaking,
        acknowledgeDestructive: locked.acknowledge_destructive,
      },
      trx,
    );
    if (planned.needsJob) {
      await writePendingChanges(context, trx, planned);
      await markShipping(context, trx, planned, {
        jobId: job.id,
        mode: 'scheduled',
        expectedDraftVersions: new Map(),
      });
    }
    return planned;
  });
  if (ship.needsJob) {
    const current = await changeSetsRepository.findById(row.id, deps.db);
    if (current) {
      await finishShipping(context, deps, current, job);
    }
    return;
  }
  await finalizeShip(context, {
    changeSetId: row.id,
    entryItems: ship.entryItems,
    activation: activationItemsOf(ship),
    expectedDraftVersions: new Map(),
    owns: (current) => isScheduledRun(current, job.id),
    logChangedAfterReview: true,
  });
};

const failSet = async (
  context: ChangeSetServiceContext,
  deps: HandlerDeps,
  changeSetId: string,
  error: unknown,
) => {
  const failure =
    error instanceof PrerequisiteFailure
      ? {
          code: 'SCHEMA_PREREQUISITE_FAILED',
          message: error.failure.reason,
          itemId: null,
          details: error.failure,
        }
      : shipFailureOf(error);
  await abandonPendingChanges(deps, changeSetId, failure);
  await recordShipFailure(
    context,
    changeSetId,
    failure,
    await changeSetItemsRepository.listForSet(changeSetId, deps.db),
  );
  return failure;
};

export const createChangeSetShipHandler =
  (environment: PublishingJobEnvironment): JobHandler =>
  async (job) => {
    const { changeSetId } = job.payload as ShipJobPayload;
    const db = environment.runtime.db;
    const row = await changeSetsRepository.findById(changeSetId, db);
    if (!row || !(isScheduledRun(row, job.id) || isShippingRun(row, job.id))) {
      return { skipped: row?.status ?? 'missing' };
    }
    const scheduled = isScheduledRun(row, job.id);
    const deps: HandlerDeps = { db, ports: createContentPorts(db) };
    let context: ChangeSetServiceContext | undefined;
    try {
      const actor = await actorFor(environment, row, scheduled);
      context = { ...(await jobContentContext(environment, actor)), ports: deps.ports };
      await (scheduled ? shipScheduled(context, deps, row, job) : finishShipping(context, deps, row, job));
      const shipped = await changeSetsRepository.findById(changeSetId, db);
      return { changeSetId, status: shipped?.status, snapshot: shipped?.shipped_seq ?? null };
    } catch (error) {
      if (error instanceof ShipAlreadyHandled) {
        return { skipped: error.status };
      }
      const final =
        error instanceof PrerequisiteFailure ||
        error instanceof PermanentJobError ||
        isPermanentPublicationError(error) ||
        job.attempt >= job.maxAttempts;
      if (!final) {
        throw error;
      }
      const failureContext = context ?? {
        ...(await jobContentContext(environment, { kind: 'system', component: 'change-sets' })),
        ports: deps.ports,
      };
      const failure = await failSet(failureContext, deps, changeSetId, error);
      job.log.warn({ changeSetId, failure }, 'change set failed to ship; nothing of it went live');
      return { changeSetId, status: 'failed', failure };
    }
  };

export const CHANGE_SET_SHIP_JOB = PUBLISHING_JOBS.changeSetShip;
