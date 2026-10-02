import { createHash } from 'node:crypto';
import type { Kysely, Transaction } from 'kysely';
import type { DB } from '../../db/types.js';
import * as entriesRepository from '../../repositories/entries.js';
import * as uniqueValuesRepository from '../../repositories/uniqueValues.js';
import type { StepOutcome } from '../../schema/planner/contentPorts.js';
import { stepKey, type ContentStep } from '../../schema/planner/steps.js';
import type { SchemaSnapshot } from '../../schema/snapshot.js';
import { resolveModelById } from '../model.js';
import { uniqueKeysOf } from '../unique.js';
import { buildValidator, isMissingValue } from '../validator/index.js';
import { ownerContainers } from './paths.js';
import { isLenientDraft, isTransformStep, type EntryProposal, type ProposedHead } from './propose.js';

/**
 * The checks of a schema change, run on an entry's proposed heads (propose.ts): required values, the
 * change's validation steps, whole-entry validation of every head the change rewrites, and uniqueness.
 * Uniqueness claims the proposed values in the unique registry: the field is not unique under the active
 * schema yet, so no write reads or maintains those rows, and a failed change discards them.
 */
type Executor = Kysely<DB> | Transaction<DB>;

/** Failing heads per step key. */
export type StepFailures = Map<string, number>;

export type Tally = { invalidCount: number; samples: string[] };
export type Tallies = Record<string, Tally>;

const MAX_SAMPLES = 10;

/** Models whose entries a step reads. */
export const stepModelIds = (step: ContentStep): string[] =>
  step.kind === 'checkUnique'
    ? [step.modelId]
    : [...new Set(step.locations.map((location) => location.modelId))];

export const ownerOf = (steps: readonly ContentStep[]) => {
  const [step] = steps;
  return step?.kind === 'checkUnique' ? step.modelId : (step?.ownerId ?? '');
};

const appliesTo = (step: ContentStep, head: ProposedHead) => stepModelIds(step).includes(head.model_id);

const lacksRequired = (step: Extract<ContentStep, { kind: 'validateRequired' }>, head: ProposedHead) =>
  !isLenientDraft(head) &&
  step.locations
    .filter((location) => location.modelId === head.model_id)
    .some((location) =>
      ownerContainers(head.data, location.path, step.ownerId).some((container) =>
        isMissingValue(container[step.fieldId]),
      ),
    );

const isValid = (proposed: SchemaSnapshot, head: ProposedHead) => {
  const model = resolveModelById(proposed, head.model_id);
  return (
    !model ||
    buildValidator(proposed, model).validate(head.data, { skipRequired: isLenientDraft(head) }).issues
      .length === 0
  );
};

/**
 * The step a whole-entry validation failure is reported under: the change's own validation step, else (for a
 * head the change rewrites) the first conversion or backfill.
 */
const validationStepKey = (steps: readonly ContentStep[], head: ProposedHead) => {
  const declared = steps.find((step) => step.kind === 'validateValues' && appliesTo(step, head));
  if (declared) {
    return stepKey(declared);
  }
  const transform = head.changed
    ? steps.find((step) => isTransformStep(step) && appliesTo(step, head))
    : undefined;
  return transform ? stepKey(transform) : undefined;
};

/**
 * Where a uniqueness check stages its claims. A field becoming unique has no live rows, so it stages under
 * its own ID. A field that is already unique (its type changes) keeps its live rows until activation, so it
 * stages under a separate, deterministic registry ID: old-type hashes can neither collide with the proposed
 * ones nor be lost if the change fails.
 */
export const registryFieldIdOf = (step: Extract<ContentStep, { kind: 'checkUnique' }>): string => {
  if (!step.rebuild) {
    return step.fieldId;
  }
  const hex = createHash('sha256').update(`shapio:unique-staging:${step.fieldId}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

/** Claims the entry's proposed values; false when another entry holds one of them. */
const claimUnique = async (
  step: Extract<ContentStep, { kind: 'checkUnique' }>,
  proposal: EntryProposal,
  proposed: SchemaSnapshot,
  executor: Executor,
): Promise<boolean> => {
  const model = resolveModelById(proposed, step.modelId);
  const field = model?.definition.fields.find((candidate) => candidate.id === step.fieldId);
  if (!model || !field) {
    return true;
  }
  const heads = proposal.heads.filter((head) => head.model_id === step.modelId);
  const keys = [...uniqueKeysOf(model.definition, [field], heads)].sort(([a], [b]) => a.localeCompare(b));
  for (const [, key] of keys) {
    const owner = await uniqueValuesRepository.claim(
      { ...key, fieldId: registryFieldIdOf(step), entryId: proposal.entryId, modelId: step.modelId },
      executor,
    );
    if (owner !== proposal.entryId) {
      return false;
    }
  }
  return true;
};

const add = (failures: StepFailures, key: string, count = 1) =>
  failures.set(key, (failures.get(key) ?? 0) + count);

/** Runs every check of the change on one entry's proposal. */
export const checkEntry = async (
  proposal: EntryProposal,
  steps: readonly ContentStep[],
  context: { proposed: SchemaSnapshot; executor: Executor },
): Promise<StepFailures> => {
  const failures: StepFailures = new Map(proposal.failedSteps);
  for (const head of proposal.heads) {
    for (const step of steps) {
      if (step.kind === 'validateRequired' && appliesTo(step, head) && lacksRequired(step, head)) {
        add(failures, stepKey(step));
      }
    }
    const validationKey = validationStepKey(steps, head);
    if (validationKey && !isValid(context.proposed, head)) {
      add(failures, validationKey);
    }
  }
  for (const step of steps) {
    if (
      step.kind === 'checkUnique' &&
      !(await claimUnique(step, proposal, context.proposed, context.executor))
    ) {
      add(failures, stepKey(step));
    }
  }
  return failures;
};

export const tallyFailures = (tallies: Tallies, entryId: string, failures: StepFailures) => {
  for (const [key, count] of failures) {
    const tally = (tallies[key] ??= { invalidCount: 0, samples: [] });
    tally.invalidCount += count;
    if (tally.samples.length < MAX_SAMPLES && !tally.samples.includes(entryId)) {
      tally.samples.push(entryId);
    }
  }
};

const failureReason = (step: ContentStep, count: number): string => {
  switch (step.kind) {
    case 'validateRequired':
      return `${count} entry version(s) have no value for the required field`;
    case 'checkUnique':
      return `${count} entry version(s) share a value that must be unique`;
    case 'convert':
      return `${count} entry version(s) hold values that cannot be converted`;
    default:
      return `${count} entry version(s) do not satisfy the new definition`;
  }
};

/** The outcome of a run: the first failing step in plan order, or ok. */
export const outcomeOf = (steps: readonly ContentStep[], tallies: Tallies): StepOutcome => {
  for (const step of steps) {
    const tally = tallies[stepKey(step)];
    if (tally && tally.invalidCount > 0) {
      return {
        ok: false,
        step: stepKey(step),
        reason: failureReason(step, tally.invalidCount),
        invalidCount: tally.invalidCount,
        sampleEntryIds: [...tally.samples],
      };
    }
  }
  return { ok: true };
};

const SINGLETON_REASON = 'A single type can hold only one entry; delete the others first';

/** A model that becomes a singleton may hold at most one entry (definition-level `validateValues`). */
export const singletonViolation = async (
  steps: readonly ContentStep[],
  proposed: SchemaSnapshot,
  executor: Executor,
): Promise<StepOutcome | undefined> => {
  for (const step of steps) {
    if (step.kind !== 'validateValues' || step.fieldId) {
      continue;
    }
    const model = resolveModelById(proposed, step.ownerId);
    if (
      model?.definition.kind === 'singleton' &&
      (await entriesRepository.countLive(step.ownerId, executor)) > 1
    ) {
      return { ok: false, step: stepKey(step), reason: SINGLETON_REASON };
    }
  }
  return undefined;
};

/** Releases what a dry run staged (never the live rows of a field that is already unique). */
export const discardStaged = async (steps: readonly ContentStep[], executor: Executor) => {
  for (const step of steps) {
    if (step.kind === 'checkUnique') {
      await uniqueValuesRepository.removeForField(registryFieldIdOf(step), executor);
    }
  }
};

/** At activation: the staged rows of already-unique fields replace their live rows. */
export const promoteStaged = async (steps: readonly ContentStep[], executor: Executor) => {
  for (const step of steps) {
    if (step.kind === 'checkUnique' && step.rebuild) {
      await uniqueValuesRepository.replaceField(registryFieldIdOf(step), step.fieldId, executor);
    }
  }
};
