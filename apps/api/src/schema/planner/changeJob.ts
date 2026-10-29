import type { Transaction } from 'kysely';
import type { Database } from '../../db/index.js';
import type { DB } from '../../db/types.js';
import { describeError } from '../../helpers/errors.js';
import { type JobContext, type JobHandler, PermanentJobError } from '../../jobs/types.js';
import * as schemaChangeJobsRepository from '../../repositories/schemaChangeJobs.js';
import type { SchemaChangeJobRow } from '../../repositories/schemaChangeJobs.js';
import * as schemaModelsRepository from '../../repositories/schemaModels.js';
import { readStoredDefinition } from '../storedDefinition.js';
import { activateDefinitions, type ActivationItem } from './activate.js';
import { principalFromColumns } from './actor.js';
import type {
  ActivationContext,
  ContentStepContext,
  RequiredGap,
  SchemaContentPorts,
  StepOutcome,
} from './contentPorts.js';
import { mergeGaps, type ChangeResult } from './gaps.js';
import { buildEntryOrderIndex, buildFieldIndex, dropFieldIndex, ENTRY_ORDER_INDEX_JOB } from './indexes.js';
import { createFieldIndexLayoutHandler, FIELD_INDEX_LAYOUT_JOB } from './indexLayout.js';
import type { ChangePlan } from './plan.js';
import {
  changeIdsOf,
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
  /** The dry run's required-value gaps, added to the activation re-check's. */
  gaps?: RequiredGap[];
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
    ...(raw.gaps ? { gaps: raw.gaps } : {}),
  };
};

const failOn = (outcome: StepOutcome): Extract<StepOutcome, { ok: true }> => {
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
    if (outcome.gaps) {
      checkpoint.gaps = outcome.gaps;
    }
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

/**
 * Runs inside the activation transaction: the watermark re-check, then the content rewrite. Returns what the
 * change leaves to do (the dry run's and the re-check's required-value gaps), or undefined when nothing.
 */
export const applyContent =
  (deps: HandlerDeps, steps: readonly PrerequisiteStep[], checkpoint: Checkpoint) =>
  async (trx: Transaction<DB>, activation: ActivationContext): Promise<ChangeResult | undefined> => {
    const contentSteps = contentStepsOf(steps);
    if (contentSteps.length === 0) {
      return undefined;
    }
    const outcome = failOn(
      await deps.ports.migration.apply(
        contentSteps,
        checkpoint.watermarks[CONTENT_STEPS_KEY] ?? null,
        trx,
        activation,
      ),
    );
    const requiredGaps = mergeGaps(checkpoint.gaps, outcome.gaps);
    return requiredGaps.length > 0 ? { requiredGaps } : undefined;
  };

/** Releases what a change's dry run staged (unique-registry claims); idempotent. */
export const discardStaged = (deps: HandlerDeps, steps: readonly PrerequisiteStep[]) =>
  deps.ports.migration.discard(contentStepsOf(steps));

/** One job checkpoint holding the prerequisite progress of several changes, keyed by change ID. */
export const keyedCheckpointIo = (job: JobContext, changeId: string): StepsCheckpointIo => {
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

/**
 * Runs the prerequisites of in-flight changes that activate together (a change set, a `schema apply`) and
 * returns their activation items; `ioFor` says where each change's checkpoint lives.
 */
export const prepareChanges = async (
  deps: HandlerDeps,
  changes: readonly SchemaChangeJobRow[],
  job: JobContext,
  ioFor: (changeId: string) => StepsCheckpointIo = (changeId) => keyedCheckpointIo(job, changeId),
): Promise<ActivationItem[]> => {
  const items: ActivationItem[] = [];
  for (const change of changes) {
    const plan = change.plan as unknown as ChangePlan;
    await schemaChangeJobsRepository.markRunning(change.id, new Date(), deps.db);
    const checkpoint = await runSteps(deps, plan.prerequisites, job, ioFor(change.id));
    const revision = change.to_revision_id
      ? await schemaModelsRepository.findRevisionById(change.to_revision_id, deps.db)
      : undefined;
    if (!revision && plan.operation !== 'delete') {
      throw new PermanentJobError(
        `Revision ${change.to_revision_id ?? '(none)'} of change ${change.id} not found`,
      );
    }
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

/** The changes a `schema.change` job runs, if every one is still in flight (all finish together). */
const loadInFlight = async (deps: HandlerDeps, changeIds: readonly string[], context: JobContext) => {
  const changes = await Promise.all(changeIds.map((id) => schemaChangeJobsRepository.findById(id, deps.db)));
  const open = changes.filter(
    (change): change is SchemaChangeJobRow =>
      change !== undefined && (change.status === 'pending' || change.status === 'running'),
  );
  if (open.length === changes.length) {
    return { changes: open };
  }
  // Changes of one job activate or fail together; one finished without the rest can never activate them.
  for (const change of open) {
    await markFailed(
      deps,
      { id: change.id, plan: change.plan as unknown as ChangePlan },
      { reason: 'Another change of the same request finished without this one' },
      context,
    );
  }
  return {
    finished: changes.map((change, index) => ({
      changeId: changeIds[index],
      status: change?.status ?? 'missing',
    })),
  };
};

/**
 * `schema.change`: dry-runs the content steps and builds the indexes of its changes (resuming from the
 * checkpoint), then activates the pending revisions together; the activation re-checks content written
 * after the watermark and rewrites converted values in the same transaction. Content that fails a check
 * fails every change of the job and leaves the previous revisions active and stored content untouched
 * (brief §5); the job itself succeeds, since retrying cannot help.
 */
const createSchemaChangeHandler =
  (deps: HandlerDeps): JobHandler =>
  async (context) => {
    const payload = context.payload as SchemaChangeJobPayload;
    const changeIds = changeIdsOf(payload);
    const loaded = await loadInFlight(deps, changeIds, context);
    if ('finished' in loaded) {
      return { changeIds, changes: loaded.finished };
    }
    const { changes } = loaded;
    const first = changes[0] as SchemaChangeJobRow;
    try {
      // A single change keeps its checkpoint at the root of the job's (jobs enqueued before groups existed).
      const items = await prepareChanges(
        deps,
        changes,
        context,
        'changeId' in payload ? () => context : undefined,
      );
      const results = await activateDefinitions(deps.db, {
        items,
        actor: principalFromColumns(first.requested_by_type, first.requested_by_id),
      });
      context.log.info({ changeIds, results }, 'schema change activated');
      return { changeIds, status: 'activated', results };
    } catch (error) {
      const fail = async (failure: ChangeFailure) => {
        for (const change of changes) {
          await markFailed(
            deps,
            { id: change.id, plan: change.plan as unknown as ChangePlan },
            failure,
            context,
          );
        }
      };
      if (error instanceof PrerequisiteFailure) {
        await fail(error.failure);
        return { changeIds, status: 'failed', failure: error.failure };
      }
      const permanent = error instanceof PermanentJobError || context.attempt >= context.maxAttempts;
      if (permanent || (error instanceof Error && 'statusCode' in error)) {
        // Out of attempts, or a rejection from activation (version conflict, invalid schema): final.
        await fail({ reason: describeError(error) });
        return { changeIds, status: 'failed' };
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
  [ENTRY_ORDER_INDEX_JOB, async (context) => ({ outcome: await buildEntryOrderIndex(deps.db, context.log) })],
];
