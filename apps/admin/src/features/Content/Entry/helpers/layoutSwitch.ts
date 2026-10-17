import type { PlanPreview } from '@shapio/client';
import { storedEntryLayout, type EntryLayout, type ModelDefinition } from '@shapio/schema';

/**
 * The definition with `display.layout` set (`storedEntryLayout`): Document is the default, so a model that
 * extends nothing leaves it unset, while a kind spells it out (unset would inherit its parent's layout).
 */
export const withEntryLayout = (definition: ModelDefinition, layout: EntryLayout): ModelDefinition => {
  const display = { ...definition.display };
  delete display.layout;
  const stored = storedEntryLayout(definition, layout);
  return { ...definition, display: stored === undefined ? display : { ...display, layout: stored } };
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
