import { createHash } from 'node:crypto';
import { changeDropsValues } from '@shapio/schema';
import type { Kysely, Transaction } from 'kysely';
import type { DB } from '../../db/types.js';
import * as entriesRepository from '../../repositories/entries.js';
import * as uniqueValuesRepository from '../../repositories/uniqueValues.js';
import type { RequiredGap, StepOutcome } from '../../schema/planner/contentPorts.js';
import { stepKey, type ContentStep } from '../../schema/planner/steps.js';
import type { SchemaById } from '../../schema/snapshot.js';
import { resolveModelById } from '../model.js';
import { uniqueKeysOf } from '../unique.js';
import { buildValidator, isMissingValue } from '../validator/index.js';
import { ownerContainers } from './paths.js';
import { isLenientDraft, isTransformStep, type EntryProposal, type ProposedHead } from './propose.js';

/**
 * The checks of a schema change, run on an entry's proposed heads (propose.ts): required values, the
 * change's validation steps, whole-entry validation of every head the change rewrites, and uniqueness.
 * Missing required values never fail a change (ADR 0002 amendment 2026-10-29): they are counted as gaps,
 * the change goes live, and the entries are listed in the Inbox until filled in. Whole-entry validation
 * therefore skips required values too: an entry left with a gap by an earlier change must not fail a later,
 * unrelated one.
 * Uniqueness claims the proposed values in the unique registry: the field is not unique under the active
 * schema yet, so no write reads or maintains those rows, and a failed change discards them.
 */
type Executor = Kysely<DB> | Transaction<DB>;

/** Failing heads per step key. */
export type StepFailures = Map<string, number>;

/** One entry's checks: heads that fail a step, and heads without a value a `validateRequired` step needs. */
export type EntryChecks = { failures: StepFailures; gaps: StepFailures };

/** Heads (`invalidCount`) and distinct entries counted for one step, with a few of those entries. */
export type Tally = { invalidCount: number; entries?: number; samples: string[] };
export type Tallies = Record<string, Tally>;

const MAX_SAMPLES = 10;

/** Models whose entries a step reads. */
export const stepModelIds = (step: ContentStep): string[] =>
  step.kind === 'checkUnique'
    ? [step.modelId]
    : [...new Set(step.locations.map((location) => location.modelId))];

/** The definition a change's steps are for (a family member's checks name the changed model as owner). */
export const ownerOf = (steps: readonly ContentStep[]) => {
  const [step] = steps;
  return step?.kind === 'checkUnique' ? (step.ownerId ?? step.modelId) : (step?.ownerId ?? '');
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

const isValid = (proposed: SchemaById, head: ProposedHead) => {
  const model = resolveModelById(proposed, head.model_id);
  return (
    !model || buildValidator(proposed, model).validate(head.data, { skipRequired: true }).issues.length === 0
  );
};

/** A conversion that clears values (a type Shapio cannot convert, a field a moved type loses): never fails. */
const clearsValues = (step: ContentStep) => step.kind === 'convert' && changeDropsValues(step.change);

/**
 * The step a whole-entry validation failure is reported under: the change's own validation step, else (for a
 * head the change rewrites) the first conversion or backfill, preferring one that can itself fail over one
 * that only clears values.
 */
const validationStepKey = (steps: readonly ContentStep[], head: ProposedHead) => {
  const declared = steps.find((step) => step.kind === 'validateValues' && appliesTo(step, head));
  if (declared) {
    return stepKey(declared);
  }
  const transforms = head.changed
    ? steps.filter((step) => isTransformStep(step) && appliesTo(step, head))
    : [];
  const transform = transforms.find((step) => !clearsValues(step)) ?? transforms[0];
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
  proposed: SchemaById,
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
  context: { proposed: SchemaById; executor: Executor },
): Promise<EntryChecks> => {
  const failures: StepFailures = new Map(proposal.failedSteps);
  const gaps: StepFailures = new Map();
  for (const head of proposal.heads) {
    for (const step of steps) {
      if (step.kind === 'validateRequired' && appliesTo(step, head) && lacksRequired(step, head)) {
        add(gaps, stepKey(step));
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
  return { failures, gaps };
};

/** Adds one entry's counts: its heads, and the entry itself once per step. */
export const tallyFailures = (tallies: Tallies, entryId: string, failures: StepFailures) => {
  for (const [key, count] of failures) {
    const tally = (tallies[key] ??= { invalidCount: 0, entries: 0, samples: [] });
    tally.invalidCount += count;
    tally.entries = (tally.entries ?? 0) + 1;
    if (tally.samples.length < MAX_SAMPLES && !tally.samples.includes(entryId)) {
      tally.samples.push(entryId);
    }
  }
};

/**
 * The required-value gaps of a run, per `validateRequired` step with any. The dry run and the activation's
 * re-check each count their own entries, and the change job adds them up (`mergeGaps`): an entry edited
 * while the dry run was going is counted by both (as it was, then as it is), so the totals may be slightly
 * high. Accepted: they say how much there is to fill in, and the Inbox lists the entries exactly.
 */
export const gapsOf = (steps: readonly ContentStep[], tallies: Tallies): RequiredGap[] =>
  steps.flatMap((step) => {
    const tally = tallies[stepKey(step)];
    if (step.kind !== 'validateRequired' || !tally || tally.invalidCount === 0) {
      return [];
    }
    return [
      {
        step: stepKey(step),
        ownerId: step.ownerId,
        fieldId: step.fieldId,
        ...(step.fieldApiKey ? { fieldApiKey: step.fieldApiKey } : {}),
        versions: tally.invalidCount,
        entries: tally.entries ?? tally.samples.length,
        sampleEntryIds: [...tally.samples],
      },
    ];
  });

const failureReason = (step: ContentStep, count: number): string => {
  switch (step.kind) {
    case 'checkUnique':
      return `${count} entry version(s) share a value that must be unique`;
    case 'convert':
      // Clearing a value always succeeds: such a step only fails for what the cleared entry then lacks.
      return clearsValues(step)
        ? `${count} entry version(s) do not satisfy the new definition`
        : `${count} entry version(s) hold values that cannot be converted`;
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

/** A model that becomes a singleton may hold at most one entry per site (definition-level `validateValues`). */
export const singletonViolation = async (
  steps: readonly ContentStep[],
  proposed: SchemaById,
  executor: Executor,
): Promise<StepOutcome | undefined> => {
  for (const step of steps) {
    if (step.kind !== 'validateValues' || step.fieldId) {
      continue;
    }
    const model = resolveModelById(proposed, step.ownerId);
    if (
      model?.definition.kind === 'singleton' &&
      // One entry per site (sites plan §H): only a site holding several entries blocks the change.
      (await entriesRepository.maxLivePerSite(step.ownerId, executor)) > 1
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
      await uniqueValuesRepository.removeForField(registryFieldIdOf(step), [step.modelId], executor);
    }
  }
};

/**
 * At activation: the staged rows of already-unique fields replace their live rows. A field a family shares
 * has one check per member, all staged under the same registry ID: it is swapped once, for all of them.
 */
export const promoteStaged = async (steps: readonly ContentStep[], executor: Executor) => {
  const swapped = new Set<string>();
  for (const step of steps) {
    if (step.kind === 'checkUnique' && step.rebuild && !swapped.has(step.fieldId)) {
      swapped.add(step.fieldId);
      await uniqueValuesRepository.replaceField(registryFieldIdOf(step), step.fieldId, executor);
    }
  }
};
