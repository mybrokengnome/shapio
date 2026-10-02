import type { Kysely } from 'kysely';
import type { DB } from '../db/types.js';
import { computeRetryDelayMs } from '../helpers/backoff.js';
import { describeError } from '../helpers/errors.js';
import { sleep } from '../helpers/sleep.js';
import * as jobsRepository from '../repositories/jobs.js';
import type { JobRow } from '../repositories/jobs.js';
import { relayOutboxEvents } from './outbox.js';
import {
  PermanentJobError,
  type JobContext,
  type JobHandlers,
  type JobLogger,
  type OutboxSubscriber,
} from './types.js';

/** How long aborted handlers get to return before their leases are released regardless. */
const ABORT_GRACE_MS = 1000;

export type WorkerOptions = {
  db: Kysely<DB>;
  handlers: JobHandlers;
  subscribers?: readonly OutboxSubscriber[];
  workerId: string;
  concurrency: number;
  pollIntervalMs: number;
  leaseMs: number;
  log: JobLogger;
  now?: () => Date;
};

export type Worker = {
  start: () => void;
  /** Stops claiming, waits up to `timeoutMs` for running jobs, then aborts them and releases their leases. */
  stop: (timeoutMs: number) => Promise<void>;
  /** Runs one claim + relay pass; for tests and tooling. Returns the number of jobs claimed. */
  tick: () => Promise<number>;
  readonly runningJobIds: ReadonlySet<string>;
};

/**
 * The job runner (ADR 0007). Leases jobs with SKIP LOCKED, heartbeats the lease while a handler runs, and
 * fences every state change on its own lease so a worker that was presumed dead cannot clobber a newer
 * attempt. A crashed worker's jobs are reclaimed when their lease expires.
 */
export const createWorker = (options: WorkerOptions): Worker => {
  const { db, handlers, subscribers = [], workerId, concurrency, pollIntervalMs, leaseMs, log } = options;
  const now = options.now ?? (() => new Date());
  const running = new Map<string, { promise: Promise<void>; job: JobRow }>();
  const stopping = new AbortController();
  const handlerAbort = new AbortController();
  let loop: Promise<void> | undefined;
  let heartbeat: NodeJS.Timeout | undefined;

  const fenceOf = (job: JobRow) => ({ id: job.id, workerId });
  const leaseFrom = (at: Date) => new Date(at.getTime() + leaseMs);

  const settleFailure = async (job: JobRow, error: unknown) => {
    const message = describeError(error);
    const permanent = error instanceof PermanentJobError;
    if (permanent || job.attempts >= job.max_attempts) {
      log.error({ err: error, jobId: job.id, jobType: job.type, attempt: job.attempts }, 'job dead');
      await jobsRepository.markDead(fenceOf(job), message, now(), db);
      return;
    }
    const runAt = new Date(now().getTime() + computeRetryDelayMs(job.attempts));
    log.warn(
      { err: error, jobId: job.id, jobType: job.type, attempt: job.attempts, runAt },
      'job failed; retrying',
    );
    await jobsRepository.markForRetry(fenceOf(job), message, runAt, now(), db);
  };

  const execute = async (job: JobRow) => {
    const jobLog = log.child({ jobId: job.id, jobType: job.type, attempt: job.attempts });
    // Reclaimed after too many crashes: the lease expired on the final attempt.
    if (job.attempts > job.max_attempts) {
      await jobsRepository.markDead(fenceOf(job), 'Lease expired on the final attempt', now(), db);
      jobLog.error('job dead after lease expiry');
      return;
    }
    const handler = handlers.get(job.type);
    if (!handler) {
      await jobsRepository.markDead(
        fenceOf(job),
        `No handler registered for job type "${job.type}"`,
        now(),
        db,
      );
      jobLog.error('job dead: no handler');
      return;
    }
    const context: JobContext = {
      id: job.id,
      type: job.type,
      payload: job.payload,
      attempt: job.attempts,
      maxAttempts: job.max_attempts,
      idempotencyKey: job.idempotency_key,
      checkpoint: job.checkpoint,
      saveCheckpoint: (checkpoint) => jobsRepository.saveCheckpoint(fenceOf(job), checkpoint, now(), db),
      signal: handlerAbort.signal,
      log: jobLog,
    };
    try {
      const result = await handler(context);
      if (handlerAbort.signal.aborted) {
        // Shutdown interrupted the handler; its return value may be partial. Run it again later.
        await jobsRepository.release(fenceOf(job), now(), db);
        return;
      }
      const stillOwned = await jobsRepository.markSucceeded(fenceOf(job), result, now(), db);
      if (!stillOwned) {
        jobLog.warn('job finished after its lease was taken over; result discarded');
      }
    } catch (error) {
      if (handlerAbort.signal.aborted) {
        await jobsRepository.release(fenceOf(job), now(), db);
        return;
      }
      await settleFailure(job, error);
    }
  };

  const launch = (job: JobRow) => {
    const promise = execute(job)
      .catch((error: unknown) => {
        log.error(
          { err: error, jobId: job.id },
          'job bookkeeping failed; lease will expire and the job retry',
        );
      })
      .finally(() => running.delete(job.id));
    running.set(job.id, { promise, job });
  };

  const tick = async () => {
    const capacity = concurrency - running.size;
    let claimed = 0;
    if (capacity > 0 && !stopping.signal.aborted) {
      const at = now();
      const jobs = await jobsRepository.claimRunnable(
        { workerId, limit: capacity, now: at, leaseUntil: leaseFrom(at) },
        db,
      );
      jobs.forEach(launch);
      claimed = jobs.length;
    }
    await relayOutboxEvents({ db, subscribers, log, now });
    return claimed;
  };

  const renewLeases = async () => {
    const at = now();
    for (const { job } of running.values()) {
      const owned = await jobsRepository.extendLease(fenceOf(job), leaseFrom(at), at, db);
      if (!owned) {
        log.warn({ jobId: job.id }, 'lease lost while running');
      }
    }
  };

  const runLoop = async () => {
    while (!stopping.signal.aborted) {
      let claimed = 0;
      try {
        claimed = await tick();
      } catch (error) {
        log.error({ err: error }, 'worker poll failed');
      }
      // Busy: poll again at once. Idle or full: wait (woken early on stop).
      if (claimed === 0 || running.size >= concurrency) {
        await sleep(pollIntervalMs, stopping.signal);
      }
    }
  };

  return {
    start: () => {
      if (loop) {
        return;
      }
      log.info({ workerId, concurrency }, 'worker started');
      heartbeat = setInterval(
        () => {
          renewLeases().catch((error: unknown) => log.error({ err: error }, 'lease renewal failed'));
        },
        Math.max(100, Math.floor(leaseMs / 3)),
      );
      loop = runLoop();
    },
    stop: async (timeoutMs) => {
      stopping.abort();
      await loop;
      const settleRunning = (ms: number) =>
        Promise.race([Promise.allSettled([...running.values()].map((entry) => entry.promise)), sleep(ms)]);
      await settleRunning(timeoutMs);
      if (running.size > 0) {
        // Ask handlers to stop; an aborted handler's job is released, not completed (see execute).
        log.warn({ jobIds: [...running.keys()] }, 'aborting unfinished jobs on shutdown');
        handlerAbort.abort();
        await settleRunning(ABORT_GRACE_MS);
        const at = now();
        for (const { job } of running.values()) {
          await jobsRepository.release(fenceOf(job), at, db);
        }
      }
      clearInterval(heartbeat);
      log.info({ workerId }, 'worker stopped');
    },
    tick,
    get runningJobIds() {
      return new Set(running.keys());
    },
  };
};
