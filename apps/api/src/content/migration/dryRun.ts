import type { Database } from '../../db/index.js';
import * as uniqueValuesRepository from '../../repositories/uniqueValues.js';
import type { ContentStepContext, StepOutcome } from '../../schema/planner/contentPorts.js';
import type { ContentStep } from '../../schema/planner/steps.js';
import {
  checkEntry,
  outcomeOf,
  ownerOf,
  registryFieldIdOf,
  singletonViolation,
  stepModelIds,
  tallyFailures,
  type Tallies,
} from './checks.js';
import { isTransformStep, proposeEntry } from './propose.js';
import { loadProposedSnapshot } from './proposed.js';
import { acquireWatermark, changedAfter, scanEntries, type EntryCursor } from './scan.js';

/**
 * The dry run of a schema change's content steps (ADR 0002 pipeline), resumable through its checkpoint.
 * Every entry whose heads are all at or below the watermark is converted and backfilled in memory and
 * checked against the proposed schema. Nothing is written to content; the only writes are the staged
 * unique-registry claims, which the change discards when it fails. Entries written after the watermark
 * are left to the activation's re-check.
 */
type DryRunCheckpoint = {
  watermark: string;
  cursor: EntryCursor;
  tallies: Tallies;
  /** Stale registry rows of the fields becoming unique were cleared before the first batch. */
  prepared: boolean;
};

export const contentModelIds = (steps: readonly ContentStep[]) => [...new Set(steps.flatMap(stepModelIds))];

const startCheckpoint = async (
  database: Database,
  steps: readonly ContentStep[],
  context: ContentStepContext,
): Promise<DryRunCheckpoint> => {
  const saved = context.checkpoint as Partial<DryRunCheckpoint> | null;
  if (saved?.watermark !== undefined && saved.tallies) {
    return {
      watermark: saved.watermark,
      cursor: saved.cursor ?? null,
      tallies: saved.tallies,
      prepared: !!saved.prepared,
    };
  }
  return {
    watermark: await acquireWatermark(database, contentModelIds(steps)),
    cursor: null,
    tallies: {},
    prepared: false,
  };
};

export const dryRun = async (
  database: Database,
  steps: readonly ContentStep[],
  context: ContentStepContext,
): Promise<StepOutcome> => {
  const proposed = await loadProposedSnapshot(database, ownerOf(steps));
  const singleton = await singletonViolation(steps, proposed, database);
  if (singleton) {
    return singleton;
  }
  const checkpoint = await startCheckpoint(database, steps, context);
  if (!checkpoint.prepared) {
    // No write maintains staged rows (new unique fields, or the staging key of a field already unique):
    // anything left is from an earlier attempt.
    for (const step of steps) {
      if (step.kind === 'checkUnique') {
        await uniqueValuesRepository.removeForField(registryFieldIdOf(step), database);
      }
    }
    checkpoint.prepared = true;
    await context.saveCheckpoint(checkpoint);
  }
  const transforms = steps.filter(isTransformStep);
  await scanEntries(
    database,
    {
      modelIds: contentModelIds(steps),
      cursor: checkpoint.cursor,
      signal: context.signal,
      onBatchDone: async (cursor) => {
        checkpoint.cursor = cursor;
        await context.saveCheckpoint(checkpoint);
      },
    },
    async (heads) => {
      if (changedAfter(heads, checkpoint.watermark)) {
        return;
      }
      const proposal = proposeEntry(heads, transforms, proposed.defaultLocale);
      const failures = await checkEntry(proposal, steps, { proposed, executor: database });
      tallyFailures(checkpoint.tallies, proposal.entryId, failures);
    },
  );
  const outcome = outcomeOf(steps, checkpoint.tallies);
  if (!outcome.ok) {
    context.log.warn(
      { step: outcome.step, invalidCount: outcome.invalidCount },
      'content does not satisfy the change',
    );
    return outcome;
  }
  return { ok: true, watermark: checkpoint.watermark };
};
