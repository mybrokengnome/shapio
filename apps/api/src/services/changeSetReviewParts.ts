import type { DataType, FieldDefinition } from '@shapio/schema';
import { REVIEW_USAGE_DAYS } from '../constants/publishing.js';
import { everyRowReadMask, maskAllows } from '../content/compiler/policy.js';
import type { ContentModel } from '../content/model.js';
import type { ChangeSetRow } from '../repositories/changeSets.js';
import type { PlanImpact } from '../schema/planner/impact.js';
import type { ChangePlan } from '../schema/planner/plan.js';
import type { DraftPlan } from './changeSetPlanning.js';
import type { ChangeSetServiceContext } from './changeSets.js';
import type { ChangeSetView, SchemaOperation } from './changeSetViews.js';
import { seesEverySite } from './networkScope.js';
import { summarizeValue, type FieldSummary, type SummaryLookups } from './reviewSummary.js';
import type { NotRestorable } from './snapshotRestore.js';
import { consumersOf } from './usage.js';

/**
 * The parts of a change set review shared by an unshipped set's review (computed against the live state,
 * changeSetReview.ts) and a shipped set's (rebuilt from what its snapshot published, changeSetShippedReview.ts):
 * the response types, the field-level entry diff and the readers of fields a breaking change affects.
 */

export type Issue = { path: string; code: string; message: string };

export type ReviewEntryItem = {
  itemId: string;
  entryId: string;
  modelId: string;
  modelKey: string | null;
  title: string | null;
  locale: string;
  action: 'publish' | 'unpublish';
  sourceRevisionId: string | null;
  draftVersion: number | null;
  liveState: 'unpublished' | 'published' | 'modified' | 'missing';
  /** Each changed field with its stored values and a readable summary of each (null when empty). */
  fields: Array<{
    fieldId: string;
    apiKey: string;
    label: string;
    type: DataType;
    before: unknown;
    after: unknown;
    summary: FieldSummary;
  }>;
  issues: Issue[];
};

export type ReviewSchemaItem = {
  itemId: string;
  draftId: string;
  definitionId: string;
  category: 'model' | 'component';
  apiKey: string;
  operation: SchemaOperation;
  baseVersion: number | null;
  activeVersion: number | null;
  stale: boolean;
  plan: ChangePlan | null;
  impact: PlanImpact | null;
  /**
   * Entries of the models the change affects, per site (sites plan §H, option a): the schema is shared, so
   * shipping converts every site's content and takes one snapshot on each affected site.
   */
  affectedEntriesBySite: Array<{ site: { id: string; key: string }; entries: number }>;
  issues: Issue[];
  alsoChangedIn: Array<{ id: string; title: string }>;
  /** A shipped set: the revision the draft replaced (null for a new definition, and for unshipped sets). */
  beforeRevisionId: string | null;
};

export type FieldConsumersView = {
  modelId: string;
  fieldId: string;
  apiKey: string;
  consumers: Array<{
    /** The site the reads were made on. */
    site: { id: string; key: string };
    principalKey: string;
    label: string | null;
    reads: number;
    lastReadAt: Date | null;
    selection: 'explicit' | 'implicit';
  }>;
  /** Readers on sites the viewer does not see in detail, as totals; null when the viewer sees every site. */
  otherSites: { consumers: number; reads: number } | null;
};

export type ChangeSetReview = {
  changeSet: ChangeSetView;
  entries: ReviewEntryItem[];
  schema: ReviewSchemaItem[];
  notRestorable: NotRestorable[];
  consumers: FieldConsumersView[];
  usageDays: number;
  checks: { breaking: boolean; destructive: boolean; blocking: Issue[]; warnings: Issue[] };
  notices: string[];
};

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export const fieldDiff = (
  fields: readonly FieldDefinition[],
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
) =>
  fields.flatMap((field) => {
    const old = before?.[field.id] ?? null;
    const next = after?.[field.id] ?? null;
    return sameValue(old, next) ? [] : [{ field, before: old, after: next }];
  });

type RawFieldDiff = ReturnType<typeof fieldDiff>[number];
export type RawEntryReview = Omit<ReviewEntryItem, 'fields'> & { fields: RawFieldDiff[] };

export const withSummaries = (entry: RawEntryReview, lookups: SummaryLookups): ReviewEntryItem => ({
  ...entry,
  fields: entry.fields.map(({ field, before, after }) => ({
    fieldId: field.id,
    apiKey: field.apiKey,
    label: field.label,
    type: field.type,
    before,
    after,
    summary: { before: summarizeValue(field, before, lookups), after: summarizeValue(field, after, lookups) },
  })),
});

/** The model's fields the actor may read (none without read access). */
export const readableFields = async (
  context: ChangeSetServiceContext,
  model: ContentModel | undefined,
  modelId: string,
): Promise<readonly FieldDefinition[]> => {
  if (!model) {
    return [];
  }
  const policy = await context.permissions.evaluate(context.actor, { action: 'read', modelId });
  return policy.allowed
    ? model.definition.fields.filter((field) => maskAllows(everyRowReadMask(policy), field))
    : [];
};

/** Fields whose breaking changes affect readers, with who read them recently. */
export const consumersFor = async (context: ChangeSetServiceContext, plans: readonly DraftPlan[]) => {
  const affected = plans.flatMap((planned) =>
    (planned.plan?.changes ?? []).flatMap((change) => {
      const fieldId = (change as { fieldId?: string }).fieldId;
      const field = planned.before?.fields.find((candidate) => candidate.id === fieldId);
      return change.breaking && fieldId && field
        ? [{ modelId: planned.draft.definition_id, fieldId, apiKey: field.apiKey }]
        : [];
    }),
  );
  const unique = [...new Map(affected.map((entry) => [entry.fieldId, entry])).values()];
  if (unique.length === 0) {
    return [];
  }
  const usage = await consumersOf(
    unique.map((entry) => entry.fieldId),
    REVIEW_USAGE_DAYS,
    {
      siteId: context.site.id,
      network: seesEverySite(context.actor),
      siteFieldIds: new Set(
        unique
          .filter((entry) => context.snapshot.scopeOf(entry.modelId) === context.site.id)
          .map((entry) => entry.fieldId),
      ),
    },
  );
  return unique.map((entry): FieldConsumersView => {
    const found = usage.find((row) => row.fieldId === entry.fieldId);
    return {
      ...entry,
      otherSites: found?.otherSites ?? null,
      consumers: (found?.principals ?? []).map((principal) => ({
        site: principal.site,
        principalKey: principal.principalKey,
        label: principal.tokenName ?? null,
        reads: principal.reads,
        lastReadAt: principal.lastReadAt,
        selection: principal.selection,
      })),
    };
  });
};

/** A restore set's entries that could not be restored (stored when the set was created). */
export const notRestorableOf = (row: Pick<ChangeSetRow, 'restore_report'>): NotRestorable[] =>
  Array.isArray(row.restore_report) ? (row.restore_report as unknown as NotRestorable[]) : [];
