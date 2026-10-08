import type { DataType, FieldDefinition } from '@shapio/schema';
import { REVIEW_USAGE_DAYS } from '../constants/publishing.js';
import { maskAllows } from '../content/compiler/policy.js';
import { resolveModelById } from '../content/model.js';
import { buildValidator } from '../content/validator/index.js';
import * as changeSetItemsRepository from '../repositories/changeSetItems.js';
import type { ChangeSetItemRow, EntryHeadRow } from '../repositories/changeSetItems.js';
import * as contentRevisionsRepository from '../repositories/contentRevisions.js';
import * as schemaDraftsRepository from '../repositories/schemaDrafts.js';
import { computeImpact, type PlanImpact } from '../schema/planner/impact.js';
import type { ChangePlan } from '../schema/planner/plan.js';
import { buildSnapshot, type SchemaSnapshot } from '../schema/snapshot.js';
import { planDrafts, type DraftPlan } from './changeSetPlanning.js';
import type { ChangeSetServiceContext } from './changeSets.js';
import {
  categoryOfKind,
  findChangeSet,
  loadChangeSetView,
  operationOf,
  titleOf,
  type ChangeSetView,
  type SchemaOperation,
} from './changeSetViews.js';
import { seesEverySite } from './networkScope.js';
import {
  loadSummaryLookups,
  summarizeValue,
  type FieldSummary,
  type SummaryLookups,
} from './reviewSummary.js';
import type { NotRestorable } from './snapshotRestore.js';
import { consumersOf } from './usage.js';

/**
 * The pull-request-shaped review of a change set (developer-face plan §2, §5): per entry item the field-level
 * diff of what goes live against what is live now, validated against the schema the set ships with; per
 * schema item the planner's classification, prerequisites and impact; the readers of fields its breaking
 * changes affect (usage, feature 2); and the checks that would make `ship` refuse.
 */
type Issue = { path: string; code: string; message: string };

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

/** Entry content cannot use fields that only the set's drafts add (v1): they are written after shipping. */
export const NOTICE_NEW_FIELDS_AFTER_SHIP = 'NEW_FIELDS_AFTER_SHIP';
/** Some entries' values are converted (or backfilled) when the set ships; the diff shows them unconverted. */
export const NOTICE_CONVERTED_ON_SHIP = 'CONVERTED_ON_SHIP';

/** The schema the set ships with: the active schema with every valid draft applied. */
const proposedSnapshotOf = (snapshot: SchemaSnapshot, plans: readonly DraftPlan[]): SchemaSnapshot => {
  const byId = new Map(snapshot.definitions.map((entry) => [entry.definition.id, entry]));
  for (const planned of plans) {
    if (planned.issues.length > 0) {
      continue;
    }
    if (planned.after) {
      byId.set(planned.draft.definition_id, {
        definition: planned.after,
        // A new definition belongs to the set's site unless its draft creates a shared one.
        siteId:
          byId.get(planned.draft.definition_id)?.siteId ?? (planned.draft.shared ? null : snapshot.siteId),
        version: (planned.activeVersion ?? 0) + 1,
        revisionId: planned.draft.id,
        hash: '',
        activatedAt: new Date(),
      });
    } else {
      byId.delete(planned.draft.definition_id);
    }
  }
  return buildSnapshot(snapshot.version, [...byId.values()], snapshot.locales, snapshot.siteId);
};

/** Models whose stored values the set converts or backfills (their drafts are checked after conversion). */
const convertedModelIds = (plans: readonly DraftPlan[]): Set<string> =>
  new Set(
    plans.flatMap((planned) =>
      (planned.plan?.prerequisites ?? []).flatMap((step) =>
        step.kind === 'convert' || step.kind === 'backfill'
          ? step.locations.map((location) => location.modelId)
          : [],
      ),
    ),
  );

const liveStateOf = (draft: EntryHeadRow | undefined, published: EntryHeadRow | undefined) => {
  if (!draft && !published) {
    return 'missing' as const;
  }
  if (!published) {
    return 'unpublished' as const;
  }
  return draft && (draft.revision_id !== published.revision_id || draft.autosaved_at)
    ? 'modified'
    : 'published';
};

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const fieldDiff = (
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
type RawEntryReview = Omit<ReviewEntryItem, 'fields'> & { fields: RawFieldDiff[] };

const withSummaries = (entry: RawEntryReview, lookups: SummaryLookups): ReviewEntryItem => ({
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

type EntryReviewContext = {
  context: ChangeSetServiceContext;
  proposed: SchemaSnapshot;
  converted: ReadonlySet<string>;
  heads: readonly EntryHeadRow[];
};

/** What an item publishes: its source revision (restore), the draft, or nothing (unpublish). */
const afterOf = async (
  review: EntryReviewContext,
  item: ChangeSetItemRow,
  draft: EntryHeadRow | undefined,
) => {
  if (item.action === 'unpublish') {
    return null;
  }
  if (item.source_revision_id) {
    const revision = await contentRevisionsRepository.findById(item.source_revision_id, review.context.db);
    return revision?.data ?? null;
  }
  return draft?.data ?? null;
};

const reviewEntry = async (review: EntryReviewContext, item: ChangeSetItemRow): Promise<RawEntryReview> => {
  const { context, proposed, converted } = review;
  const modelId = item.model_id ?? '';
  const heads = review.heads.filter((head) => head.entry_id === item.entry_id);
  const draft = heads.find((head) => head.state === 'draft' && head.locale === item.locale);
  const published = heads.find((head) => head.state === 'published' && head.locale === item.locale);
  const model = resolveModelById(proposed, modelId) ?? resolveModelById(context.snapshot, modelId);
  const policy = model
    ? await context.permissions.evaluate(context.actor, { action: 'read', modelId })
    : undefined;
  const readable =
    model && policy?.allowed
      ? model.definition.fields.filter((field) => maskAllows(policy.readMask, field))
      : [];
  const after = await afterOf(review, item, draft);
  const before = published?.data ?? null;
  const issues: Issue[] = [];
  if (item.action === 'publish' && model && after && !converted.has(modelId)) {
    issues.push(
      ...buildValidator(proposed, model)
        .validate(after)
        .issues.map((issue) => ({ path: issue.path, code: issue.code, message: issue.message })),
    );
  }
  if (item.action === 'publish' && !after) {
    issues.push({
      path: '',
      code: 'ENTRY_LOCALE_NOT_FOUND',
      message: 'There is nothing to publish in this locale',
    });
  }
  return {
    itemId: item.id,
    entryId: item.entry_id ?? '',
    modelId,
    modelKey: model?.definition.apiKey ?? null,
    title: titleOf(context.snapshot, modelId, heads, item.locale ?? ''),
    locale: item.locale ?? '',
    action: item.action as 'publish' | 'unpublish',
    sourceRevisionId: item.source_revision_id,
    draftVersion: item.action === 'publish' && !item.source_revision_id ? (draft?.version ?? null) : null,
    liveState: liveStateOf(draft, published),
    fields: fieldDiff(readable, before, after),
    issues,
  };
};

const reviewSchema = async (
  context: ChangeSetServiceContext,
  changeSetId: string,
  plans: readonly DraftPlan[],
  items: readonly ChangeSetItemRow[],
): Promise<ReviewSchemaItem[]> => {
  const others = await schemaDraftsRepository.findOtherActiveSets(
    plans.map((planned) => planned.draft.definition_id),
    changeSetId,
    context.db,
  );
  return Promise.all(
    plans.map(async (planned) => ({
      itemId: items.find((item) => item.schema_draft_id === planned.draft.id)?.id ?? '',
      draftId: planned.draft.id,
      definitionId: planned.draft.definition_id,
      category: categoryOfKind(planned.draft.kind),
      apiKey: planned.draft.api_key,
      operation: operationOf(planned.draft),
      baseVersion: planned.draft.base_version,
      activeVersion: planned.activeVersion,
      stale: planned.stale,
      plan: planned.plan,
      impact: planned.plan ? await computeImpact(planned.plan, context.ports) : null,
      affectedEntriesBySite: planned.plan
        ? await changeSetItemsRepository
            .countEntriesBySite(planned.plan.affectedModelIds, context.db)
            .then((rows) =>
              rows.map((row) => ({ site: { id: row.id, key: row.key }, entries: Number(row.entries) })),
            )
        : [],
      issues: planned.issues.map(({ path, code, message }) => ({ path, code, message })),
      alsoChangedIn: others
        .filter((other) => other.definition_id === planned.draft.definition_id)
        .map((other) => ({ id: other.id, title: other.title })),
    })),
  );
};

/** Fields whose breaking changes affect readers, with who read them recently. */
const consumersFor = async (context: ChangeSetServiceContext, plans: readonly DraftPlan[]) => {
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

const checksOf = (
  entries: readonly ReviewEntryItem[],
  schema: readonly ReviewSchemaItem[],
  plans: readonly DraftPlan[],
) => {
  const blocking: Issue[] = [
    ...schema
      .filter((item) => item.stale)
      .map((item) => ({
        path: `/schema/${item.apiKey}`,
        code: 'SCHEMA_VERSION_CONFLICT',
        message: `The draft of "${item.apiKey}" is based on version ${item.baseVersion ?? 'none'}; ${item.activeVersion ?? 'no version'} is active now`,
      })),
    ...schema.flatMap((item) =>
      item.issues.map((issue) => ({ ...issue, path: `/schema/${item.apiKey}${issue.path}` })),
    ),
    ...entries.flatMap((entry) =>
      entry.issues.map((issue) => ({ ...issue, path: `/entries/${entry.itemId}${issue.path}` })),
    ),
  ];
  const warnings: Issue[] = schema
    .filter((item) => item.alsoChangedIn.length > 0)
    .map((item) => ({
      path: `/schema/${item.apiKey}`,
      code: 'ALSO_CHANGED_IN_OTHER_SET',
      message: `"${item.apiKey}" is also changed in ${item.alsoChangedIn.map((other) => `"${other.title}"`).join(', ')}`,
    }));
  return {
    breaking: plans.some((planned) => planned.plan?.summary.breaking ?? false),
    destructive: plans.some((planned) => planned.plan?.summary.destructive ?? false),
    blocking,
    warnings,
  };
};

export const getChangeSetReview = async (
  context: ChangeSetServiceContext,
  id: string,
): Promise<ChangeSetReview> => {
  const row = await findChangeSet(context, id);
  const changeSet = await loadChangeSetView(context, id);
  const items = await changeSetItemsRepository.listForSet(id, context.db);
  const plans = await planDrafts(context, await schemaDraftsRepository.listForSet(id, context.db));
  const entryItems = items.filter((item) => item.kind === 'entry');
  const review: EntryReviewContext = {
    context,
    proposed: proposedSnapshotOf(context.snapshot, plans),
    converted: convertedModelIds(plans),
    heads: await changeSetItemsRepository.findHeadsForEntries(
      [...new Set(entryItems.map((item) => item.entry_id ?? ''))],
      context.db,
    ),
  };
  const raw: RawEntryReview[] = [];
  for (const item of entryItems) {
    raw.push(await reviewEntry(review, item));
  }
  const lookupsFor = await loadSummaryLookups(
    context,
    [review.proposed, context.snapshot],
    raw.flatMap((entry) =>
      entry.fields.map(({ field, before, after }) => ({ field, values: [before, after] })),
    ),
  );
  const entries = raw.map((entry) => withSummaries(entry, lookupsFor(entry.locale)));
  const schema = await reviewSchema(context, id, plans, items);
  const notices = [
    ...(plans.length > 0 && entryItems.length > 0 ? [NOTICE_NEW_FIELDS_AFTER_SHIP] : []),
    ...(entryItems.some((item) => review.converted.has(item.model_id ?? ''))
      ? [NOTICE_CONVERTED_ON_SHIP]
      : []),
  ];
  return {
    changeSet,
    entries,
    schema,
    notRestorable: Array.isArray(row.restore_report)
      ? (row.restore_report as unknown as NotRestorable[])
      : [],
    consumers: await consumersFor(context, plans),
    usageDays: REVIEW_USAGE_DAYS,
    checks: checksOf(entries, schema, plans),
    notices,
  };
};
