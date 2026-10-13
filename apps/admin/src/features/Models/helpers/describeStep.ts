import type { PlanStep, PlanStepImpact } from '@shapio/client';
import {
  changeDropsValues,
  isDataType,
  type DataType,
  type PlannedChange,
  type SchemaDefinition,
} from '@shapio/schema';
import { i18next } from '@/app/i18n';
import en from '@/locales/en/translation.json';
import { fieldLabelOf, type DescribeContext } from './describeChange';

type StepKind = keyof typeof en.models.steps;

const isKnownStep = (kind: string): kind is StepKind => Object.hasOwn(en.models.steps, kind);

type DroppedTypeChange = { fieldId: string | undefined; from: DataType; to: DataType };

/**
 * The type change a `convert` step carries when Shapio can't convert it and drops the field's values, as the
 * planner classified it (`dropsValues`, decided from both sides' type and settings).
 */
const droppedTypeChange = (step: PlanStep): DroppedTypeChange | undefined => {
  if (step.kind !== 'convert' || typeof step.change !== 'object' || step.change === null) {
    return undefined;
  }
  const change = step.change as PlannedChange;
  const { fieldId, from, to } = change;
  if (!changeDropsValues(change) || !isDataType(from) || !isDataType(to)) {
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
 * The other kind of the family a step runs on, by name: a parent's change runs on each kind's entries and
 * indexes (`modelId`, or the content step's `ownerId`). Nothing for the definition being described, or
 * without a name for it.
 */
const otherKindOf = (
  step: PlanStep,
  before: SchemaDefinition | null,
  after: SchemaDefinition | null,
  context: DescribeContext,
): string | undefined => {
  const modelId = step.modelId ?? step.ownerId;
  const subject = after?.id ?? before?.id;
  return modelId === undefined || modelId === subject ? undefined : context.definitionName?.(modelId);
};

/**
 * A sentence for a prerequisite or follow-up step, e.g. "Check that every entry has a Title". A conversion
 * that drops values names the field, both types and how many entries lose their value (the dry run's
 * `droppedEntries`, else the step's entry count). A step on another kind of the family starts with its
 * name ("Digital: Build the filter and sort index for Price").
 */
export const describeStep = (
  step: PlanStep,
  before: SchemaDefinition | null,
  after: SchemaDefinition | null,
  impact?: PlanStepImpact,
  context: DescribeContext = {},
): string => {
  const dropped = droppedTypeChange(step);
  const sentence = dropped
    ? i18next.t('models.plan.stepDropped', {
        field: fieldLabelOf(dropped.fieldId, before, after),
        from: typeName(dropped.from),
        to: typeName(dropped.to),
        count: impact?.droppedEntries ?? impact?.affectedHeads ?? 0,
      })
    : isKnownStep(step.kind)
      ? i18next.t(`models.steps.${step.kind}`, { field: fieldLabelOf(step.fieldId, before, after) })
      : step.kind;
  const kind = otherKindOf(step, before, after, context);
  return kind === undefined ? sentence : i18next.t('models.inheritance.stepOnKind', { kind, sentence });
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
  // A person counts entries; the check counts entry versions (draft and published, per locale): say both.
  const counts = {
    count: impact.invalidEntries ?? impact.invalidHeads,
    versions: i18next.t('models.plan.stepVersions', { count: impact.invalidHeads }),
  };
  const failing =
    step.kind === 'validateRequired'
      ? i18next.t('models.plan.stepMissingRequired', counts)
      : i18next.t('models.plan.stepInvalid', counts);
  return `${checked} · ${failing}`;
};

/** The plan already knows a prerequisite check fails (entries that wouldn't fit), so shipping it can't work. */
export const hasFailingCheck = (impacts: readonly PlanStepImpact[]): boolean =>
  impacts.some((impact) => (impact.invalidHeads ?? 0) > 0);
