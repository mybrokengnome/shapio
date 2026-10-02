import type { ChangeSummary, ClassifiedChange } from '@shapio/schema';

/**
 * How the plan preview groups changes (brief §5): applied instantly with no API impact, live and additive,
 * gated on prerequisite jobs, or breaking/destructive and needing explicit acknowledgement.
 */
export const PLAN_BUCKETS = ['breaking', 'prerequisites', 'live', 'metadata'] as const;
export type PlanBucket = (typeof PLAN_BUCKETS)[number];

const METADATA_CATEGORIES: ReadonlySet<string> = new Set(['metadata', 'editorSwap']);

export const bucketOfChange = (change: ClassifiedChange): PlanBucket => {
  if (change.breaking || change.destructive) {
    return 'breaking';
  }
  if (change.prerequisites.length > 0) {
    return 'prerequisites';
  }
  return METADATA_CATEGORIES.has(change.category) ? 'metadata' : 'live';
};

/** The plan's overall bucket: its most demanding change. */
export const bucketOfPlan = (summary: ChangeSummary): PlanBucket => {
  if (summary.breaking || summary.destructive) {
    return 'breaking';
  }
  if (summary.prerequisites.length > 0) {
    return 'prerequisites';
  }
  return summary.metadataOnly ? 'metadata' : 'live';
};

/** Changes grouped by bucket, most demanding bucket first, empty buckets left out. */
export const groupByBucket = (
  changes: readonly ClassifiedChange[],
): { bucket: PlanBucket; changes: ClassifiedChange[] }[] =>
  PLAN_BUCKETS.map((bucket) => ({
    bucket,
    changes: changes.filter((change) => bucketOfChange(change) === bucket),
  })).filter((group) => group.changes.length > 0);
