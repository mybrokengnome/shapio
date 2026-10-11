import type { PlanPreview } from '@shapio/client';
import type { EntryLayout, ModelDefinition } from '@shapio/schema';

/** The definition with `display.layout` set; Document is the default, so it is written as unset. */
export const withEntryLayout = (definition: ModelDefinition, layout: EntryLayout): ModelDefinition => {
  const display = { ...definition.display };
  delete display.layout;
  return { ...definition, display: layout === 'form' ? { ...display, layout } : display };
};

/**
 * Whether a plan can ship from the entry's drawer without a review: metadata only, nothing to check first,
 * no validation issues. A layout change always is; anything else goes through the builder's review.
 */
export const isQuietPlan = (plan: PlanPreview['plan']): boolean =>
  plan.summary.metadataOnly &&
  !plan.summary.breaking &&
  !plan.summary.destructive &&
  plan.prerequisites.length === 0 &&
  plan.issues.length === 0;
