import { PUBLISHING_JOBS } from '../constants/publishing.js';
import { PermanentJobError, type JobHandler } from '../jobs/types.js';
import * as scheduledPublicationsRepository from '../repositories/scheduledPublications.js';
import { actorColumns } from '../schema/planner/actor.js';
import { recordAudit } from '../services/audit.js';
import { AlreadyHandledError, describePublicationError, isPermanentPublicationError } from './failures.js';
import { jobContentContext, type PublishingJobEnvironment } from './jobEnvironment.js';
import { loadActor } from './principals.js';
import { runPublicationBatch } from './publicationBatch.js';

const SCHEDULER = { kind: 'system', component: 'scheduler' } as const;

/**
 * Executes one scheduled publication. Exactly once across crashes and retries: the publish and the flip
 * of the row to `done` commit together, under a row lock taken first, so a re-run (another worker after a
 * crash, or a retry after commit but before the job was marked succeeded) finds `done` and does nothing.
 * Permanent failures (invalid content, no permission) mark the schedule failed and the job dead; retrying
 * the dead job from the jobs view tries again.
 */
export const createScheduledPublicationHandler =
  (environment: PublishingJobEnvironment): JobHandler =>
  async (job) => {
    const { scheduleId } = job.payload as { scheduleId: string };
    const { runtime } = environment;
    const row = await scheduledPublicationsRepository.findById(scheduleId, runtime.db);
    const runnable =
      row && (row.status === 'scheduled' || (row.status === 'failed' && row.job_id === job.id));
    if (!row || !runnable || row.job_id !== job.id) {
      return { skipped: row?.status ?? 'missing' };
    }
    try {
      const actor = await loadActor(
        runtime.db,
        { adminUserId: row.created_by, tokenId: row.created_by_token },
        `schedule:${row.id}`,
      );
      const context = await jobContentContext(environment, actor);
      const { results } = await runPublicationBatch(
        context,
        [
          {
            ref: row.id,
            entryId: row.entry_id,
            modelId: row.model_id,
            locale: row.locale,
            action: row.action as 'publish' | 'unpublish',
          },
        ],
        'schedule',
        { source: 'schedule', actor: actorColumns(actor) },
        {
          before: async (trx) => {
            const locked = await scheduledPublicationsRepository.lockById(row.id, trx);
            if (
              !locked ||
              !(locked.status === 'scheduled' || locked.status === 'failed') ||
              locked.job_id !== job.id
            ) {
              throw new AlreadyHandledError(locked?.status ?? 'missing');
            }
          },
          after: async (trx, done) => {
            const snapshot = done[0]?.snapshot ?? null;
            await scheduledPublicationsRepository.markDone(row.id, snapshot, runtime.now(), trx);
            await recordAudit(trx, {
              actor: SCHEDULER,
              action: 'publishing.schedule.execute',
              target: { type: 'entry', id: row.entry_id },
              metadata: {
                scheduleId: row.id,
                locale: row.locale,
                action: row.action,
                snapshot,
                scheduledBy: row.created_by,
              },
            });
          },
        },
      );
      return { status: 'done', snapshot: results[0]?.snapshot ?? null };
    } catch (error) {
      if (error instanceof AlreadyHandledError) {
        return { skipped: error.status };
      }
      if (isPermanentPublicationError(error) || job.attempt >= job.maxAttempts) {
        await scheduledPublicationsRepository.markFailed(
          row.id,
          describePublicationError(error),
          runtime.now(),
          runtime.db,
        );
        throw new PermanentJobError(describePublicationError(error), { cause: error });
      }
      throw error;
    }
  };

export const SCHEDULING_JOB_TYPES = [PUBLISHING_JOBS.scheduledPublication] as const;
