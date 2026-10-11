import type { PlanStep, PlanStepImpact } from '@shapio/client';
import { isDataType, typeChangeDropsValues, type DataType, type SchemaDefinition } from '@shapio/schema';
import { i18next } from '@/app/i18n';
import en from '@/locales/en/translation.json';
import { fieldLabelOf } from './describeChange';

type StepKind = keyof typeof en.models.steps;

const isKnownStep = (kind: string): kind is StepKind => Object.hasOwn(en.models.steps, kind);

type DroppedTypeChange = { fieldId: string | undefined; from: DataType; to: DataType };

/** The type change a `convert` step carries when Shapio can't convert it and drops the field's values. */
const droppedTypeChange = (step: PlanStep): DroppedTypeChange | undefined => {
  if (step.kind !== 'convert' || typeof step.change !== 'object' || step.change === null) {
    return undefined;
  }
  const { kind, fieldId, from, to } = step.change as Record<string, unknown>;
  if (kind !== 'field.type' || !isDataType(from) || !isDataType(to) || !typeChangeDropsValues(from, to)) {
    return undefined;
  }
  return { fieldId: typeof fieldId === 'string' ? fieldId : undefined, from, to };
};

/**
 * The steps the review lists: a `validateValues` step on a field whose values a `convert` step of the same plan
 * drops is left out (nothing is left for the person to check; the server still runs it). Each step keeps its
 * impact, which the plan gives by position.
 */
export const stepsToShow = (
  steps: readonly PlanStep[],
  impacts?: readonly PlanStepImpact[],
): { step: PlanStep; impact: PlanStepImpact | undefined }[] => {
  const dropped = new Set(
    steps.flatMap((step) => {
      const change = droppedTypeChange(step);
      return change?.fieldId ? [`${String(step.ownerId)}:${change.fieldId}`] : [];
    }),
  );
  return steps
    .map((step, index) => ({ step, impact: impacts?.[index] }))
    .filter(
      ({ step }) =>
        step.kind !== 'validateValues' ||
        !step.fieldId ||
        !dropped.has(`${String(step.ownerId)}:${step.fieldId}`),
    );
};

const typeName = (type: DataType) => i18next.t(`models.dataTypes.${type}.name`);

/**
 * A sentence for a prerequisite or follow-up step, e.g. "Check that every entry has a Title". A conversion
 * that drops values names the field, both types and how many entries lose their value (the dry run's
 * `droppedEntries`, else the step's entry count).
 */
export const describeStep = (
  step: PlanStep,
  before: SchemaDefinition | null,
  after: SchemaDefinition | null,
  impact?: PlanStepImpact,
): string => {
  const dropped = droppedTypeChange(step);
  if (dropped) {
    return i18next.t('models.plan.stepDropped', {
      field: fieldLabelOf(dropped.fieldId, before, after),
      from: typeName(dropped.from),
      to: typeName(dropped.to),
      count: impact?.droppedEntries ?? impact?.affectedHeads ?? 0,
    });
  }
  const field = fieldLabelOf(step.fieldId, before, after);
  return isKnownStep(step.kind) ? i18next.t(`models.steps.${step.kind}`, { field }) : step.kind;
};

/**
 * What a prerequisite would touch: entries checked and, where known, how many would fail. A conversion that
 * drops values says its count in the step itself, so it has no detail.
 */
export const describeStepImpact = (
  step: PlanStep,
  impact: PlanStepImpact | undefined,
): string | undefined => {
  if (!impact || droppedTypeChange(step)) {
    return undefined;
  }
  const checked = i18next.t('models.plan.stepEntries', { count: impact.affectedHeads });
  if (!impact.invalidHeads) {
    return checked;
  }
  const failing =
    step.kind === 'validateRequired'
      ? i18next.t('models.plan.stepMissingRequired', { count: impact.invalidHeads })
      : i18next.t('models.plan.stepInvalid', { count: impact.invalidHeads });
  return `${checked} · ${failing}`;
};
