import { PUBLICATION_JOB_MAX_ATTEMPTS, PUBLISHING_JOBS } from '../constants/publishing.js';
import { AppError } from '../helpers/appError.js';
import { enqueueJob } from '../jobs/queue.js';
import { decodeCursor, pageSize, toPage, type Page } from '../publishing/pagination.js';
import { adminIdOf, tokenIdOf } from '../publishing/principals.js';
import { modelKeyOf, resolvePublicationTarget, type PublicationTargetInput } from '../publishing/targets.js';
import * as scheduledPublicationsRepository from '../repositories/scheduledPublications.js';
import type { ScheduledPublicationRow } from '../repositories/scheduledPublications.js';
import type { SchemaSnapshot } from '../schema/snapshot.js';
import { recordAudit } from './audit.js';
import { modelWithPolicy, type ContentServiceContext } from './contentAccess.js';

/**
 * Publish-at / unpublish-at per entry and locale (package H). A schedule is a row plus a delayed job; the job
 * re-checks permissions and validity when it runs and flips the row in the publishing transaction, so it
 * publishes exactly once however often the job is retried (publishing/scheduling.ts).
 */
export type ScheduleView = {
  id: string;
  entryId: string;
  modelId: string;
  modelKey: string | null;
  locale: string;
  action: 'publish' | 'unpublish';
  runAt: Date;
  status: 'scheduled' | 'done' | 'failed' | 'cancelled';
  error: string | null;
  snapshot: number | null;
  createdBy: string | null;
  createdAt: Date;
  executedAt: Date | null;
};

export const toScheduleView = (snapshot: SchemaSnapshot, row: ScheduledPublicationRow): ScheduleView => ({
  id: row.id,
  entryId: row.entry_id,
  modelId: row.model_id,
  modelKey: modelKeyOf(snapshot, row.model_id),
  locale: row.locale,
  action: row.action as ScheduleView['action'],
  runAt: row.run_at,
  status: row.status as ScheduleView['status'],
  error: row.error,
  snapshot: row.snapshot_seq === null ? null : Number(row.snapshot_seq),
  createdBy: row.created_by,
  createdAt: row.created_at,
  executedAt: row.executed_at,
});

/** Schedules may be at most a minute in the past (clock skew); later than that is a mistake. */
const PAST_TOLERANCE_MS = 60_000;

export const createSchedule = async (
  context: ContentServiceContext,
  input: PublicationTargetInput & { runAt: Date },
): Promise<ScheduleView> => {
  const now = new Date();
  if (input.runAt.getTime() < now.getTime() - PAST_TOLERANCE_MS) {
    throw new AppError(400, 'SCHEDULE_IN_PAST', 'Choose a time in the future');
  }
  const target = await resolvePublicationTarget(context, input);
  const row = await context.db.transaction().execute(async (trx) => {
    const inserted = await scheduledPublicationsRepository.insert(
      {
        entry_id: target.entryId,
        model_id: target.model.definition.id,
        locale: target.locale,
        action: target.action,
        run_at: input.runAt,
        created_by: adminIdOf(context.actor),
        created_by_token: tokenIdOf(context.actor),
      },
      trx,
    );
    const { job } = await enqueueJob(
      {
        type: PUBLISHING_JOBS.scheduledPublication,
        payload: { scheduleId: inserted.id },
        runAt: input.runAt,
        maxAttempts: PUBLICATION_JOB_MAX_ATTEMPTS,
        idempotencyKey: `schedule:${inserted.id}`,
      },
      trx,
    );
    await scheduledPublicationsRepository.setJob(inserted.id, job.id, trx);
    await recordAudit(trx, {
      actor: context.actor,
      action: `publishing.schedule.${target.action}`,
      target: { type: 'entry', id: target.entryId },
      metadata: {
        scheduleId: inserted.id,
        modelKey: input.modelKey,
        locale: target.locale,
        runAt: input.runAt.toISOString(),
      },
      ...(context.requestId ? { requestId: context.requestId } : {}),
      ...(context.ip ? { ip: context.ip } : {}),
    });
    return { ...inserted, job_id: job.id };
  });
  return toScheduleView(context.snapshot, row);
};

const scheduleNotFound = (id: string) =>
  new AppError(404, 'SCHEDULE_NOT_FOUND', `No scheduled publication ${id}`, { id });

/** Cancels a pending (or failed) schedule. Needs publish permission on the entry's model. */
export const cancelSchedule = async (context: ContentServiceContext, id: string): Promise<void> => {
  const existing = await scheduledPublicationsRepository.findById(id, context.db);
  const modelKey = existing ? modelKeyOf(context.snapshot, existing.model_id) : null;
  if (!existing) {
    throw scheduleNotFound(id);
  }
  if (modelKey) {
    await modelWithPolicy(context, modelKey, 'publish');
  }
  await context.db.transaction().execute(async (trx) => {
    const cancelled = await scheduledPublicationsRepository.cancel(id, new Date(), trx);
    if (!cancelled) {
      throw new AppError(409, 'SCHEDULE_NOT_PENDING', 'Only schedules that have not run can be cancelled', {
        id,
        status: existing.status,
      });
    }
    await recordAudit(trx, {
      actor: context.actor,
      action: 'publishing.schedule.cancel',
      target: { type: 'entry', id: existing.entry_id },
      metadata: { scheduleId: id, locale: existing.locale, action: existing.action },
      ...(context.requestId ? { requestId: context.requestId } : {}),
      ...(context.ip ? { ip: context.ip } : {}),
    });
  });
};

/**
 * Lists schedules. Without `entryId` it needs `publishing.manage` (checked by the route); with one, read
 * permission on that entry's model is enough (the entry form shows its own schedules).
 */
export const listSchedules = async (
  context: ContentServiceContext,
  query: { status?: string; entryId?: string; cursor?: string; limit?: number },
  { canSeeAll }: { canSeeAll: boolean },
): Promise<Page<ScheduleView>> => {
  if (!canSeeAll && !query.entryId) {
    throw new AppError(403, 'FORBIDDEN', 'Your role does not allow publishing.manage');
  }
  const limit = pageSize(query.limit);
  const rows = await scheduledPublicationsRepository.list(
    {
      ...(query.status ? { status: query.status } : {}),
      ...(query.entryId ? { entryId: query.entryId } : {}),
    },
    decodeCursor(query.cursor),
    limit + 1,
    context.db,
  );
  if (!canSeeAll) {
    for (const modelId of new Set(rows.map((row) => row.model_id))) {
      const modelKey = modelKeyOf(context.snapshot, modelId);
      if (modelKey) {
        await modelWithPolicy(context, modelKey, 'read');
      }
    }
  }
  return toPage(rows, limit, (row) => toScheduleView(context.snapshot, row));
};
