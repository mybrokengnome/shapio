import { CHANGE_SET_EVENTS, PUBLICATION_JOB_MAX_ATTEMPTS, PUBLISHING_JOBS } from '../constants/publishing.js';
import { AppError } from '../helpers/appError.js';
import { writeOutboxEvent } from '../jobs/outbox.js';
import { enqueueJob } from '../jobs/queue.js';
import {
  activationItemsOf,
  assertReviewedDraftVersions,
  planShip,
  writePendingChanges,
} from '../publishing/changeSetPrepare.js';
import {
  finalizeShip,
  isRefusal,
  recordShipFailure,
  ShipAlreadyHandled,
  shipFailureOf,
  startShipJob,
} from '../publishing/changeSetShip.js';
import { isPermanentPublicationError } from '../publishing/failures.js';
import { adminIdOf, tokenIdOf } from '../publishing/principals.js';
import * as changeSetItemsRepository from '../repositories/changeSetItems.js';
import * as changeSetsRepository from '../repositories/changeSets.js';
import type { ChangeSetRow } from '../repositories/changeSets.js';
import { auditChangeSet, getChangeSet, type ChangeSetServiceContext } from './changeSets.js';
import { changeSetNotFound, changeSetVersionConflict, type ChangeSetView } from './changeSetViews.js';
import type { Acknowledgement } from './schemaDefinitions.js';

/**
 * Shipping and scheduling a change set (developer-face plan §5). An interactive ship is strict: the client
 * sends the draft versions its review showed, and a moved draft refuses the ship (409 CHANGE_SET_STALE).
 * Without prerequisites the ship completes in the request (200: shipped, or failed with the failing item);
 * with them the set goes `shipping` and a job finishes it (202).
 */
export type ShipInput = Acknowledgement & {
  expectedVersion: number;
  itemVersions?: Array<{ itemId: string; draftVersion: number }> | undefined;
};

export type ShipOutcome = { view: ChangeSetView; inline: boolean };

const SHIPPABLE: ReadonlySet<string> = new Set(['open', 'failed']);

const notShippable = (status: string) =>
  new AppError(409, 'CHANGE_SET_NOT_SHIPPABLE', `A ${status} change set cannot ship now`, { status });

const checkShippable = (row: ChangeSetRow | undefined, id: string, expectedVersion: number): ChangeSetRow => {
  if (!row) {
    throw changeSetNotFound(id);
  }
  if (!SHIPPABLE.has(row.status)) {
    throw notShippable(row.status);
  }
  if (row.version !== expectedVersion) {
    throw changeSetVersionConflict(expectedVersion, row.version);
  }
  return row;
};

export const shipChangeSet = async (
  context: ChangeSetServiceContext,
  id: string,
  input: ShipInput,
): Promise<ShipOutcome> => {
  const versions = new Map((input.itemVersions ?? []).map((entry) => [entry.itemId, entry.draftVersion]));
  const prepared = await context.db.transaction().execute(async (trx) => {
    const row = checkShippable(await changeSetsRepository.lockById(id, trx), id, input.expectedVersion);
    const ship = await planShip(context, row, input, trx);
    if (ship.needsJob) {
      await assertReviewedDraftVersions(trx, ship.entryItems, versions);
      await writePendingChanges(context, trx, ship);
      await startShipJob(context, trx, ship, versions);
    }
    return ship;
  });
  if (prepared.needsJob) {
    return { view: await getChangeSet(context, id), inline: false };
  }
  try {
    await finalizeShip(context, {
      changeSetId: id,
      entryItems: prepared.entryItems,
      activation: activationItemsOf(prepared),
      expectedDraftVersions: versions,
      owns: (row) => SHIPPABLE.has(row.status) && row.version === prepared.row.version,
    });
  } catch (error) {
    if (error instanceof ShipAlreadyHandled) {
      throw notShippable(error.status);
    }
    if (isRefusal(error) || !isPermanentPublicationError(error)) {
      throw error;
    }
    await recordShipFailure(context, id, shipFailureOf(error), prepared.entryItems);
  }
  return { view: await getChangeSet(context, id), inline: true };
};

/**
 * Schedules the set: checked now like a ship (with the acknowledgements, stored for the job), shipped at
 * `at` by `changeSet.ship`; a set with prerequisites starts its dry run at `at` and goes live when it ends.
 */
export const scheduleChangeSet = async (
  context: ChangeSetServiceContext,
  id: string,
  input: Acknowledgement & { at: Date; expectedVersion: number },
): Promise<ChangeSetView> => {
  if (input.at.getTime() < Date.now() - 60_000) {
    throw new AppError(400, 'SCHEDULE_IN_PAST', 'Choose a time in the future');
  }
  await context.db.transaction().execute(async (trx) => {
    const row = await changeSetsRepository.lockById(id, trx);
    if (!row) {
      throw changeSetNotFound(id);
    }
    // Rescheduling is allowed: the earlier job finds another job ID and stops.
    if (row.status !== 'scheduled' && !SHIPPABLE.has(row.status)) {
      throw notShippable(row.status);
    }
    if (row.version !== input.expectedVersion) {
      throw changeSetVersionConflict(input.expectedVersion, row.version);
    }
    await planShip(context, row, input, trx);
    // What the scheduler agreed to: drafts that change before the ship are logged on the timeline.
    await changeSetItemsRepository.recordReviewedDraftVersions(id, trx);
    const { job } = await enqueueJob(
      {
        type: PUBLISHING_JOBS.changeSetShip,
        payload: { changeSetId: id, mode: 'scheduled' },
        runAt: input.at,
        maxAttempts: PUBLICATION_JOB_MAX_ATTEMPTS,
      },
      trx,
    );
    await changeSetsRepository.update(
      id,
      {
        status: 'scheduled',
        scheduled_for: input.at,
        schedule_job_id: job.id,
        scheduled_by: adminIdOf(context.actor),
        scheduled_by_token: tokenIdOf(context.actor),
        acknowledge_breaking: input.acknowledgeBreaking ?? false,
        acknowledge_destructive: input.acknowledgeDestructive ?? false,
        error: null,
      },
      new Date(),
      trx,
    );
    await writeOutboxEvent(trx, {
      type: CHANGE_SET_EVENTS.scheduled,
      aggregateType: 'change_set',
      aggregateId: id,
      payload: { changeSetId: id, at: input.at.toISOString() },
    });
    await auditChangeSet(trx, context, id, 'change_set.schedule', { at: input.at.toISOString() });
  });
  return getChangeSet(context, id);
};

export const unscheduleChangeSet = async (
  context: ChangeSetServiceContext,
  id: string,
): Promise<ChangeSetView> => {
  await context.db.transaction().execute(async (trx) => {
    const row = await changeSetsRepository.lockById(id, trx);
    if (!row) {
      throw changeSetNotFound(id);
    }
    if (row.status !== 'scheduled') {
      throw new AppError(409, 'CHANGE_SET_NOT_SCHEDULED', 'The change set is not scheduled');
    }
    await changeSetsRepository.update(
      id,
      { status: 'open', scheduled_for: null, schedule_job_id: null },
      new Date(),
      trx,
    );
    await auditChangeSet(trx, context, id, 'change_set.unschedule');
  });
  return getChangeSet(context, id);
};
