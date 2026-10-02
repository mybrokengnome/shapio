import type { PlanStep, PlanStepImpact } from '@shapio/client';
import type { SchemaDefinition } from '@shapio/schema';
import { i18next } from '@/app/i18n';
import en from '@/locales/en/translation.json';
import { fieldLabelOf } from './describeChange';

type StepKind = keyof typeof en.models.steps;

const isKnownStep = (kind: string): kind is StepKind => Object.hasOwn(en.models.steps, kind);

/** A sentence for a prerequisite or follow-up step, e.g. "Check that every entry has a Title". */
export const describeStep = (
  step: PlanStep,
  before: SchemaDefinition | null,
  after: SchemaDefinition | null,
): string => {
  const field = fieldLabelOf(step.fieldId, before, after);
  return isKnownStep(step.kind) ? i18next.t(`models.steps.${step.kind}`, { field }) : step.kind;
};

/** What a prerequisite would touch: entries checked and, where known, how many would fail. */
export const describeStepImpact = (impact: PlanStepImpact | undefined): string | undefined => {
  if (!impact) {
    return undefined;
  }
  const checked = i18next.t('models.plan.stepEntries', { count: impact.affectedHeads });
  return impact.invalidHeads
    ? `${checked} · ${i18next.t('models.plan.stepInvalid', { count: impact.invalidHeads })}`
    : checked;
};
