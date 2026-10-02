import { db } from '../db/index.js';
import { AppError } from '../helpers/appError.js';
import { decodeCursor, pageSize, toPage, type Page } from '../publishing/pagination.js';
import { redactSecrets } from '../publishing/redact.js';
import * as jobsRepository from '../repositories/jobs.js';
import type { JobRow } from '../repositories/jobs.js';
import * as jobsAdminRepository from '../repositories/jobsAdmin.js';
import type { ActorContext } from './actorContext.js';
import { recordAudit } from './audit.js';

/** The admin jobs view: what the queue is doing, why jobs died, and retrying them (package H). */
const JOB_STATUSES = ['pending', 'running', 'succeeded', 'dead'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export type JobView = {
  id: string;
  type: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  runAt: Date;
  idempotencyKey: string | null;
  lockedBy: string | null;
  lockedUntil: Date | null;
  payload: unknown;
  result: unknown;
  /** Progress a long job saved (its checkpoint, e.g. an import's phase and counts); null otherwise. */
  progress: unknown;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  finishedAt: Date | null;
};

export const toJobView = (row: JobRow): JobView => ({
  id: row.id,
  type: row.type,
  status: row.status as JobStatus,
  attempts: row.attempts,
  maxAttempts: row.max_attempts,
  runAt: row.run_at,
  idempotencyKey: row.idempotency_key,
  lockedBy: row.locked_by,
  lockedUntil: row.locked_until,
  payload: redactSecrets(row.payload),
  result: redactSecrets(row.result),
  progress: redactSecrets(row.checkpoint),
  lastError: row.last_error,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  finishedAt: row.finished_at,
});

export const listJobs = async (query: {
  status?: string;
  type?: string;
  cursor?: string;
  limit?: number;
}): Promise<Page<JobView>> => {
  const limit = pageSize(query.limit);
  const rows = await jobsAdminRepository.list(
    { ...(query.status ? { status: query.status } : {}), ...(query.type ? { type: query.type } : {}) },
    decodeCursor(query.cursor),
    limit + 1,
  );
  return toPage(rows, limit, toJobView);
};

export const summarizeJobs = async () => {
  const counts = Object.fromEntries(JOB_STATUSES.map((status) => [status, 0])) as Record<JobStatus, number>;
  for (const row of await jobsAdminRepository.countByStatus()) {
    if ((JOB_STATUSES as readonly string[]).includes(row.status)) {
      counts[row.status as JobStatus] = Number(row.n);
    }
  }
  return { counts, types: await jobsAdminRepository.distinctTypes() };
};

const jobNotFound = (id: string) => new AppError(404, 'JOB_NOT_FOUND', `No job ${id}`, { id });

export const getJob = async (id: string): Promise<JobView> => {
  const row = await jobsRepository.findById(id);
  if (!row) {
    throw jobNotFound(id);
  }
  return toJobView(row);
};

/** Dead jobs only: they run again from attempt 1. The handler's idempotency still applies. */
export const retryJob = async (context: ActorContext, id: string): Promise<JobView> =>
  db.transaction().execute(async (trx) => {
    const row = await jobsAdminRepository.requeueDead(id, new Date(), trx);
    if (!row) {
      if (!(await jobsRepository.findById(id, trx))) {
        throw jobNotFound(id);
      }
      throw new AppError(409, 'JOB_NOT_RETRYABLE', 'Only dead jobs can be retried', { id });
    }
    await recordAudit(trx, {
      ...context,
      action: 'job.retry',
      target: { type: 'job', id },
      metadata: { type: row.type },
    });
    return toJobView(row);
  });
