import { changeDropsValues } from '@shapio/schema';
import type { Database } from '../../db/index.js';
import * as entryHeadsRepository from '../../repositories/entryHeads.js';
import type { StepImpact } from '../../schema/planner/contentPorts.js';
import type { ContentStep } from '../../schema/planner/steps.js';
import { fieldPresentExpression } from '../compiler/expressions.js';
import { stepModelIds } from './checks.js';

/**
 * What a content step would touch, for the plan preview (brief §5 step 5), counted without a dry run. A type
 * change Shapio cannot convert also says how many entries lose their value and, for a required field, how
 * many heads (and entries) would then fail the required check. Both are exact only for a model's own fields; a field inside
 * a component is counted by the dry run alone.
 */
type ConvertStep = Extract<ContentStep, { kind: 'convert' }>;

const isModelLevel = (step: ConvertStep | Extract<ContentStep, { kind: 'validateRequired' }>) =>
  step.locations.every((location) => location.path.length === 0);

/** A convert step that drops every value of a model-level field. */
const droppingFieldId = (step: ContentStep): string | undefined => {
  if (step.kind !== 'convert' || step.change.kind !== 'field.type' || !isModelLevel(step)) {
    return undefined;
  }
  return changeDropsValues(step.change) ? step.change.fieldId : undefined;
};

/** A required field whose values the plan drops with no default to backfill: every complete head fails. */
const failsRequiredAfterDrop = (step: ContentStep, steps: readonly ContentStep[]) => {
  if (step.kind !== 'validateRequired' || !isModelLevel(step)) {
    return false;
  }
  const drops = steps.some(
    (other) =>
      other.kind === 'convert' && other.ownerId === step.ownerId && droppingFieldId(other) === step.fieldId,
  );
  const backfills = steps.some(
    (other) => other.kind === 'backfill' && other.ownerId === step.ownerId && other.fieldId === step.fieldId,
  );
  return drops && !backfills;
};

export const assessStep = async (
  database: Database,
  step: ContentStep,
  steps: readonly ContentStep[],
): Promise<StepImpact> => {
  const modelIds = stepModelIds(step);
  const affectedHeads = await entryHeadsRepository.countForModels(modelIds, database);
  const dropped = droppingFieldId(step);
  if (dropped) {
    return {
      affectedHeads,
      droppedEntries: await entryHeadsRepository.countEntriesMatching(
        modelIds,
        fieldPresentExpression(dropped),
        database,
      ),
    };
  }
  if (failsRequiredAfterDrop(step, steps)) {
    const strict = await entryHeadsRepository.countStrictHeads(modelIds, database);
    return { affectedHeads, invalidHeads: strict.heads, invalidEntries: strict.entries };
  }
  return { affectedHeads };
};
