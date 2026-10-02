import type { Kysely, Transaction } from 'kysely';
import { DEPLOYMENT_EVENTS, PROVIDER_POLL_MAX_MS, PUBLISHING_JOBS } from '../constants/publishing.js';
import type { DB } from '../db/types.js';
import { describeError } from '../helpers/errors.js';
import { writeOutboxEvent } from '../jobs/outbox.js';
import { enqueueJob } from '../jobs/queue.js';
import { PermanentJobError, type JobHandler } from '../jobs/types.js';
import type { PublishingJobEnvironment } from '../publishing/jobEnvironment.js';
import { OutboundBlockedError } from '../publishing/outbound/ssrf.js';
import type { PublishingRuntime } from '../publishing/runtime.js';
import * as deploymentConnectionsRepository from '../repositories/deploymentConnections.js';
import * as deploymentRunsRepository from '../repositories/deploymentRuns.js';
import type { DeploymentRunRow } from '../repositories/deploymentRuns.js';
import * as publicationsRepository from '../repositories/publications.js';
import * as schemaVersionsRepository from '../repositories/schemaVersions.js';
import { providerContextFor, resolveConnection } from './connections.js';
import { providerFor } from './providers/index.js';
import {
  isTerminalStatus,
  RUN_STATUS_RANK,
  type RunReport,
  type TimelineEvent,
  type TimelineSource,
} from './status.js';
import type { ResolvedConnection, RunContext } from './types.js';

type Executor = Kysely<DB> | Transaction<DB>;

export const DEPLOYMENT_JOB_MAX_ATTEMPTS = 5;

export type RunTrigger = 'publish' | 'change_set' | 'schema' | 'manual' | 'retry';

const timelineEvent = (
  status: TimelineEvent['status'],
  source: TimelineSource,
  message: string | null,
  now: Date,
): TimelineEvent => ({ status, at: now.toISOString(), source, message });

/**
 * Queues a run for a connection, or joins the run already queued (coalescing: a burst of publishes becomes
 * one build). The trigger job fires after the connection's debounce and pins the publication snapshot at
 * that moment, so the coalesced run builds the newest content.
 */
export const ensureQueuedRun = async (
  trx: Executor,
  input: {
    connectionId: string;
    debounceSeconds: number;
    trigger: RunTrigger;
    createdBy?: string | null;
    retryOf?: string | null;
    now: Date;
  },
): Promise<{ run: DeploymentRunRow; created: boolean }> => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const inserted = await deploymentRunsRepository.insertQueued(
      {
        connection_id: input.connectionId,
        trigger: input.trigger,
        created_by: input.createdBy ?? null,
        retry_of: input.retryOf ?? null,
        timeline: JSON.stringify([timelineEvent('queued', 'shapio', `Queued (${input.trigger})`, input.now)]),
      },
      trx,
    );
    if (inserted) {
      const { job } = await enqueueJob(
        {
          type: PUBLISHING_JOBS.deploymentTrigger,
          payload: { runId: inserted.id },
          runAt: new Date(input.now.getTime() + input.debounceSeconds * 1000),
          maxAttempts: DEPLOYMENT_JOB_MAX_ATTEMPTS,
          idempotencyKey: `deployment-trigger:${inserted.id}`,
        },
        trx,
      );
      await deploymentRunsRepository.setJob(inserted.id, job.id, trx);
      return { run: { ...inserted, job_id: job.id }, created: true };
    }
    const queued = await deploymentRunsRepository.findQueued(input.connectionId, trx);
    if (queued) {
      return { run: queued, created: false };
    }
    // The queued run was triggered between the insert and the lookup: queue a new one.
  }
  throw new Error(`Could not queue a deployment run for connection ${input.connectionId}`);
};

const EVENT_BY_STATUS: Partial<Record<RunReport['status'], string>> = {
  triggered: DEPLOYMENT_EVENTS.triggered,
  building: DEPLOYMENT_EVENTS.building,
  deployed: DEPLOYMENT_EVENTS.deployed,
  failed: DEPLOYMENT_EVENTS.failed,
};

/**
 * Applies a report to a run if it moves the run forward (out-of-order protection), with its timeline entry
 * and outbox event in one transaction. Returns the updated run, or undefined when the report was stale.
 */
export const applyReport = async (
  runtime: PublishingRuntime,
  runId: string,
  report: RunReport,
  source: TimelineSource,
): Promise<DeploymentRunRow | undefined> =>
  runtime.db.transaction().execute(async (trx) => {
    const now = runtime.now();
    const updated = await deploymentRunsRepository.transition(
      runId,
      {
        status: report.status,
        rank: RUN_STATUS_RANK[report.status],
        event: timelineEvent(report.status, source, report.message ?? null, now),
        terminal: isTerminalStatus(report.status),
        providerRef: report.providerRef,
        logUrl: report.logUrl,
        siteUrl: report.siteUrl,
        error: report.status === 'failed' ? (report.message ?? 'Failed') : undefined,
        now,
      },
      trx,
    );
    if (!updated) {
      // Still record details a stale report brings (e.g. the log URL) without changing the state.
      await deploymentRunsRepository.setProviderDetails(runId, report, trx);
      return undefined;
    }
    const type = EVENT_BY_STATUS[report.status];
    if (type) {
      await writeOutboxEvent(trx, {
        type,
        aggregateType: 'deployment_run',
        aggregateId: runId,
        payload: {
          runId,
          connectionId: updated.connection_id,
          status: updated.status,
          trigger: updated.trigger,
          snapshot: updated.snapshot_seq === null ? null : Number(updated.snapshot_seq),
          providerRef: updated.provider_ref,
          logUrl: updated.log_url,
          siteUrl: updated.site_url,
          error: updated.error,
        },
      });
    }
    return updated;
  });

const enqueuePoll = (runtime: PublishingRuntime, runId: string, poll: number) =>
  enqueueJob(
    {
      type: PUBLISHING_JOBS.deploymentPoll,
      payload: { runId, poll },
      runAt: new Date(runtime.now().getTime() + runtime.pollIntervalMs),
      maxAttempts: DEPLOYMENT_JOB_MAX_ATTEMPTS,
      idempotencyKey: `deployment-poll:${runId}:${poll}`,
    },
    runtime.db,
  );

const failRun = async (runtime: PublishingRuntime, runId: string, message: string) => {
  await applyReport(runtime, runId, { status: 'failed', message }, 'shapio');
};

/**
 * Triggers a queued run (job `deployment.trigger`): pins the publication snapshot and schema version, calls
 * the provider, and records the outcome. A failed trigger is retried with backoff; after the last attempt
 * the run fails with the error. A retry after a crash passes the earlier attempt's time to the provider, so
 * it can adopt a deployment it already started instead of starting a second one.
 */
export const createDeploymentTriggerHandler =
  (environment: PublishingJobEnvironment): JobHandler =>
  async (job) => {
    const { runtime } = environment;
    const { runId } = job.payload as { runId: string };
    const run = await deploymentRunsRepository.findById(runId, runtime.db);
    if (!run || run.status !== 'queued') {
      return { skipped: run?.status ?? 'missing' };
    }
    const row = await deploymentConnectionsRepository.findById(run.connection_id, runtime.db);
    if (!row || !row.enabled) {
      await failRun(runtime, runId, row ? 'The connection is disabled' : 'The connection was deleted');
      return { status: 'failed' };
    }
    const seq = await publicationsRepository.currentSeq(runtime.db);
    const schemaVersion = await schemaVersionsRepository.getSchemaVersion(runtime.db);
    await deploymentRunsRepository.setSnapshot(runId, { seq, schemaVersion }, runtime.db);
    const previous = (job.checkpoint as { sentAt?: string } | null)?.sentAt;
    await job.saveCheckpoint({ sentAt: previous ?? runtime.now().toISOString() });

    const provider = providerFor(row.provider);
    let connection: ResolvedConnection;
    try {
      connection = resolveConnection(runtime, row);
    } catch (error) {
      // A secret's environment variable is missing: retrying will not help until the server is fixed.
      const message = error instanceof Error ? error.message : String(error);
      await failRun(runtime, runId, `Trigger failed: ${message}`);
      throw new PermanentJobError(message, { cause: error });
    }
    const context: RunContext = {
      ...providerContextFor(runtime, connection, job.signal),
      run: { ...run, snapshot_seq: String(seq), schema_version: schemaVersion },
      environment,
      previousAttemptAt: previous ? new Date(previous) : undefined,
    };
    let report: RunReport;
    try {
      report = await provider.trigger(context);
    } catch (error) {
      const message = describeError(error);
      if (error instanceof OutboundBlockedError || job.attempt >= job.maxAttempts) {
        await failRun(runtime, runId, `Trigger failed: ${message}`);
        throw new PermanentJobError(message, { cause: error });
      }
      await deploymentRunsRepository.appendTimeline(
        runId,
        timelineEvent(
          'queued',
          'shapio',
          `Trigger attempt ${job.attempt} failed: ${message}; retrying`,
          runtime.now(),
        ),
        runtime.now(),
        runtime.db,
      );
      throw error;
    }
    if (report.status !== 'triggered') {
      await applyReport(runtime, runId, { status: 'triggered', message: 'Trigger sent' }, 'shapio');
    }
    await applyReport(runtime, runId, report, 'shapio');
    if (provider.poll && !isTerminalStatus(report.status)) {
      await enqueuePoll(runtime, runId, 1);
    }
    return { status: report.status, snapshot: seq };
  };

/**
 * Reads a run's real state from the provider (job `deployment.poll`), re-enqueued until the run finishes.
 * After PROVIDER_POLL_MAX_MS without a final state the run is marked `unknown` rather than guessed.
 */
export const createDeploymentPollHandler =
  (environment: PublishingJobEnvironment): JobHandler =>
  async (job) => {
    const { runtime } = environment;
    const { runId, poll } = job.payload as { runId: string; poll: number };
    const run = await deploymentRunsRepository.findById(runId, runtime.db);
    if (!run || isTerminalStatus(run.status) || run.status === 'unknown') {
      return { skipped: run?.status ?? 'missing' };
    }
    const row = await deploymentConnectionsRepository.findById(run.connection_id, runtime.db);
    const provider = row ? providerFor(row.provider) : undefined;
    if (!row || !provider?.poll) {
      return { skipped: 'no poller' };
    }
    let report: RunReport;
    try {
      report = await provider.poll({
        ...providerContextFor(runtime, resolveConnection(runtime, row), job.signal),
        run,
        environment,
        previousAttemptAt: undefined,
      });
    } catch (error) {
      if (job.attempt >= job.maxAttempts) {
        await applyReport(
          runtime,
          runId,
          {
            status: 'unknown',
            message: `Could not read the status from the provider: ${describeError(error)}`,
          },
          'shapio',
        );
        throw new PermanentJobError(describeError(error), { cause: error });
      }
      throw error;
    }
    await applyReport(runtime, runId, report, 'provider');
    if (isTerminalStatus(report.status)) {
      return { status: report.status };
    }
    const since = (run.triggered_at ?? run.created_at).getTime();
    if (runtime.now().getTime() - since > PROVIDER_POLL_MAX_MS) {
      await applyReport(
        runtime,
        runId,
        {
          status: 'unknown',
          message: 'The provider did not report a final state in time; check its build log',
        },
        'shapio',
      );
      return { status: 'unknown' };
    }
    await enqueuePoll(runtime, runId, poll + 1);
    return { status: report.status };
  };
