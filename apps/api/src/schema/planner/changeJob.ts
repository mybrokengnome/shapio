import type { Transaction } from 'kysely';
import type { Database } from '../../db/index.js';
import type { DB } from '../../db/types.js';
import { describeError } from '../../helpers/errors.js';
import { type JobContext, type JobHandler, PermanentJobError } from '../../jobs/types.js';
import * as schemaChangeJobsRepository from '../../repositories/schemaChangeJobs.js';
import * as schemaModelsRepository from '../../repositories/schemaModels.js';
import { readStoredDefinition } from '../storedDefinition.js';
import { activateDefinition } from './activate.js';
import { principalFromColumns } from './actor.js';
import type {
  ActivationContext,
  ContentStepContext,
  SchemaContentPorts,
  StepOutcome,
} from './contentPorts.js';
import { buildFieldIndex, dropFieldIndex } from './indexes.js';
import { createFieldIndexLayoutHandler, FIELD_INDEX_LAYOUT_JOB } from './indexLayout.js';
import type { ChangePlan } from './plan.js';
import {
  SCHEMA_CHANGE_JOB,
  SCHEMA_FOLLOW_UP_JOB,
  type SchemaChangeJobPayload,
  type SchemaFollowUpJobPayload,
} from './prerequisites.js';
import { isIndexStep, stepKey, type ContentStep, type PrerequisiteStep } from './steps.js';

/** Stored with the change row so the UI and CLI can say what failed and why. */
export type ChangeFailure = {
  step?: string;
  reason: string;
  invalidCount?: number;
  sampleEntryIds?: string[];
};

export type Checkpoint = {
  completed: string[];
  watermarks: Record<string, unknown>;
  stepCheckpoints: Record<string, unknown>;
};

/** Checkpoint key of the content steps, which run together as one dry run. */
const CONTENT_STEPS_KEY = 'content';

export class PrerequisiteFailure extends Error {
  readonly failure: ChangeFailure;

  constructor(failure: ChangeFailure) {
    super(failure.reason);
    this.name = 'PrerequisiteFailure';
    this.failure = failure;
  }
}

const readCheckpoint = (value: unknown): Checkpoint => {
  const raw = (value ?? {}) as Partial<Checkpoint>;
  return {
    completed: raw.completed ?? [],
    watermarks: raw.watermarks ?? {},
    stepCheckpoints: raw.stepCheckpoints ?? {},
  };
};

const failOn = (outcome: StepOutcome) => {
  if (!outcome.ok) {
    throw new PrerequisiteFailure({
      step: outcome.step ?? CONTENT_STEPS_KEY,
      reason: outcome.reason,
      ...(outcome.invalidCount !== undefined ? { invalidCount: outcome.invalidCount } : {}),
      ...(outcome.sampleEntryIds ? { sampleEntryIds: outcome.sampleEntryIds } : {}),
    });
  }
  return outcome;
};

export type HandlerDeps = { db: Database; ports: SchemaContentPorts };

const contentStepsOf = (steps: readonly PrerequisiteStep[]) =>
  steps.filter((step): step is ContentStep => !isIndexStep(step));

/** Resumable progress of one change's prerequisites, as the job saves it. */
export type StepsCheckpointIo = {
  checkpoint: unknown;
  saveCheckpoint: (checkpoint: unknown) => Promise<boolean>;
};

/**
 * The dry run of the content steps, then the index builds; each resumes from the checkpoint. A change set
 * runs several changes in one job, so where the checkpoint lives is the caller's (`io`).
 */
export const runSteps = async (
  deps: HandlerDeps,
  steps: readonly PrerequisiteStep[],
  context: JobContext,
  io: StepsCheckpointIo = context,
): Promise<Checkpoint> => {
  const checkpoint = readCheckpoint(io.checkpoint);
  const contentSteps = contentStepsOf(steps);
  if (contentSteps.length > 0 && !checkpoint.completed.includes(CONTENT_STEPS_KEY)) {
    const stepContext: ContentStepContext = {
      signal: context.signal,
      checkpoint: checkpoint.stepCheckpoints[CONTENT_STEPS_KEY] ?? null,
      saveCheckpoint: (value) =>
        io.saveCheckpoint({
          ...checkpoint,
          stepCheckpoints: { ...checkpoint.stepCheckpoints, [CONTENT_STEPS_KEY]: value },
        }),
      log: context.log,
    };
    const outcome = failOn(await deps.ports.migration.run(contentSteps, stepContext));
    checkpoint.watermarks[CONTENT_STEPS_KEY] = outcome.watermark ?? null;
    checkpoint.completed.push(CONTENT_STEPS_KEY);
    await io.saveCheckpoint(checkpoint);
  }
  for (const step of steps.filter(isIndexStep)) {
    const key = stepKey(step);
    if (checkpoint.completed.includes(key)) {
      continue;
    }
    await buildFieldIndex(deps.db, step, context.log);
    checkpoint.completed.push(key);
    await io.saveCheckpoint(checkpoint);
  }
  return checkpoint;
};

/** Runs inside the activation transaction: the watermark re-check, then the content rewrite. */
export const applyContent =
  (deps: HandlerDeps, steps: readonly PrerequisiteStep[], checkpoint: Checkpoint) =>
  async (trx: Transaction<DB>, activation: ActivationContext) => {
    const contentSteps = contentStepsOf(steps);
    if (contentSteps.length > 0) {
      failOn(
        await deps.ports.migration.apply(
          contentSteps,
          checkpoint.watermarks[CONTENT_STEPS_KEY] ?? null,
          trx,
          activation,
        ),
      );
    }
  };

/** Releases what a change's dry run staged (unique-registry claims); idempotent. */
export const discardStaged = (deps: HandlerDeps, steps: readonly PrerequisiteStep[]) =>
  deps.ports.migration.discard(contentStepsOf(steps));

/** The change failed for good: staged work is released first, so a failed release is retried with the job. */
const markFailed = async (
  deps: HandlerDeps,
  change: { id: string; plan: ChangePlan },
  failure: ChangeFailure,
  context: JobContext,
) => {
  await deps.ports.migration.discard(contentStepsOf(change.plan.prerequisites));
  await schemaChangeJobsRepository.finish(
    change.id,
    { status: 'failed', error: failure, now: new Date() },
    deps.db,
  );
  context.log.warn(
    { changeId: change.id, failure },
    'schema change failed; the previous revision stays active',
  );
};

/**
 * `schema.change`: dry-runs the change's content steps and builds its indexes (resuming from the
 * checkpoint), then activates the pending revision; the activation re-checks content written after the
 * watermark and rewrites converted values in the same transaction. Content that fails a check fails the
 * change and leaves the previous revision active and stored content untouched (brief §5); the job itself
 * succeeds, since retrying cannot help.
 */
const createSchemaChangeHandler =
  (deps: HandlerDeps): JobHandler =>
  async (context) => {
    const { changeId } = context.payload as SchemaChangeJobPayload;
    const change = await schemaChangeJobsRepository.findById(changeId, deps.db);
    if (!change || (change.status !== 'pending' && change.status !== 'running')) {
      return { changeId, status: change?.status ?? 'missing' };
    }
    if (!change.to_revision_id) {
      throw new PermanentJobError(`Schema change ${changeId} has no target revision`);
    }
    await schemaChangeJobsRepository.markRunning(changeId, new Date(), deps.db);
    const plan = change.plan as unknown as ChangePlan;
    try {
      const checkpoint = await runSteps(deps, plan.prerequisites, context);
      const revision = await schemaModelsRepository.findRevisionById(change.to_revision_id, deps.db);
      if (!revision) {
        throw new PermanentJobError(`Revision ${change.to_revision_id} not found`);
      }
      const result = await activateDefinition(
        deps.db,
        {
          plan,
          after: readStoredDefinition(revision.definition),
          expectedVersion: plan.fromVersion,
          pending: { changeJobId: changeId, revisionId: revision.id, version: revision.version },
          recheck: applyContent(deps, plan.prerequisites, checkpoint),
        },
        { actor: principalFromColumns(change.requested_by_type, change.requested_by_id) },
      );
      context.log.info({ changeId, ...result }, 'schema change activated');
      return { changeId, status: 'activated', ...result };
    } catch (error) {
      if (error instanceof PrerequisiteFailure) {
        await markFailed(deps, { id: changeId, plan }, error.failure, context);
        return { changeId, status: 'failed', failure: error.failure };
      }
      const permanent = error instanceof PermanentJobError || context.attempt >= context.maxAttempts;
      if (permanent || (error instanceof Error && 'statusCode' in error)) {
        // Out of attempts, or a rejection from activation (version conflict, invalid schema): final.
        await markFailed(deps, { id: changeId, plan }, { reason: describeError(error) }, context);
        return { changeId, status: 'failed' };
      }
      throw error;
    }
  };

/** `schema.followUp`: idempotent post-activation work. */
const createFollowUpHandler =
  (deps: HandlerDeps): JobHandler =>
  async (context) => {
    const { steps } = context.payload as SchemaFollowUpJobPayload;
    for (const step of steps) {
      if (step.kind === 'buildIndex') {
        await buildFieldIndex(deps.db, step, context.log);
      } else if (step.kind === 'dropIndex') {
        await dropFieldIndex(deps.db, step.indexName);
      } else {
        await deps.ports.migration.runFollowUp(step, context.log);
      }
    }
    return { steps: steps.length };
  };

export const createSchemaJobHandlers = (deps: HandlerDeps): Array<[string, JobHandler]> => [
  [SCHEMA_CHANGE_JOB, createSchemaChangeHandler(deps)],
  [SCHEMA_FOLLOW_UP_JOB, createFollowUpHandler(deps)],
  [FIELD_INDEX_LAYOUT_JOB, createFieldIndexLayoutHandler(deps.db)],
];
