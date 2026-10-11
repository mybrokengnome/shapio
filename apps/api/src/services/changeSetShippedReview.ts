import { REVIEW_USAGE_DAYS } from '../constants/publishing.js';
import { resolveModelById } from '../content/model.js';
import * as changeSetItemsRepository from '../repositories/changeSetItems.js';
import type { ChangeSetItemRow } from '../repositories/changeSetItems.js';
import type { ChangeSetRow } from '../repositories/changeSets.js';
import * as publicationsRepository from '../repositories/publications.js';
import * as schemaDraftsRepository from '../repositories/schemaDrafts.js';
import type { SchemaDraftRow } from '../repositories/schemaDrafts.js';
import * as schemaModelsRepository from '../repositories/schemaModels.js';
import { readStoredDefinition } from '../schema/storedDefinition.js';
import { planShippedDraft, type DraftPlan } from './changeSetPlanning.js';
import {
  consumersFor,
  fieldDiff,
  notRestorableOf,
  readableFields,
  withSummaries,
  type ChangeSetReview,
  type RawEntryReview,
  type ReviewSchemaItem,
} from './changeSetReviewParts.js';
import type { ChangeSetServiceContext } from './changeSets.js';
import { categoryOfKind, operationOf, titleOf, type ChangeSetView } from './changeSetViews.js';
import { loadSummaryLookups } from './reviewSummary.js';

/**
 * The review of a shipped change set: what it shipped, rebuilt from immutable history so it never changes
 * afterwards (a later set touching the same entries or definitions leaves it as it was).
 *
 * - Entry items: the revision each (entry, locale) served at the snapshot before the set's (N - 1) against
 *   the one it served at the set's snapshot N, from `publication_log`.
 * - Schema items: the definition at the version the draft was based on (the ship guard made it the active
 *   one) against the draft, which is locked once shipped. Impact counts are not rebuilt.
 * - No blocking checks, warnings or notices: the set passed them when it shipped.
 *
 * Sets shipped before change sets recorded their snapshot (old releases) have no number: their entries are
 * listed without a diff.
 */
type ShippedSet = { row: ChangeSetRow; changeSet: ChangeSetView; items: readonly ChangeSetItemRow[] };

type LiveRevision = Awaited<ReturnType<typeof publicationsRepository.findRevisionsLiveAt>>[number];

const keyOf = (entryId: string | null, locale: string | null) => `${entryId ?? ''}:${locale ?? ''}`;

const servedAt = async (context: ChangeSetServiceContext, entryIds: string[], seq: number | null) => {
  const rows =
    seq === null
      ? []
      : await publicationsRepository.findRevisionsLiveAt(context.site.id, entryIds, seq, context.db);
  return new Map<string, LiveRevision>(rows.map((row) => [keyOf(row.entry_id, row.locale), row]));
};

const shippedEntries = async (
  context: ChangeSetServiceContext,
  seq: number | null,
  entryItems: readonly ChangeSetItemRow[],
) => {
  const entryIds = [...new Set(entryItems.map((item) => item.entry_id ?? ''))];
  const beforeShip = await servedAt(context, entryIds, seq === null ? null : seq - 1);
  const shipped = await servedAt(context, entryIds, seq);
  const heads = await changeSetItemsRepository.findHeadsForEntries(entryIds, context.db);
  const raw: RawEntryReview[] = [];
  for (const item of entryItems) {
    const modelId = item.model_id ?? '';
    const model = resolveModelById(context.snapshot, modelId);
    const before = beforeShip.get(keyOf(item.entry_id, item.locale))?.data ?? null;
    const after = shipped.get(keyOf(item.entry_id, item.locale))?.data ?? null;
    raw.push({
      itemId: item.id,
      entryId: item.entry_id ?? '',
      modelId,
      modelKey: model?.definition.apiKey ?? null,
      // Its title as shipped (as it was before, for an unpublish), else as it is now.
      title:
        titleOf(
          context.snapshot,
          modelId,
          [after, before].flatMap((data) =>
            data ? [{ locale: item.locale ?? '', state: 'published', data }] : [],
          ),
          item.locale ?? '',
        ) ??
        titleOf(
          context.snapshot,
          modelId,
          heads.filter((head) => head.entry_id === item.entry_id),
          item.locale ?? '',
        ),
      locale: item.locale ?? '',
      action: item.action as 'publish' | 'unpublish',
      sourceRevisionId: item.source_revision_id,
      draftVersion: null,
      // The state before the ship: live or not (missing when nothing of it is left in the log).
      liveState: before ? 'published' : after ? 'unpublished' : 'missing',
      fields: fieldDiff(await readableFields(context, model, modelId), before, after),
      issues: [],
    });
  }
  const lookupsFor = await loadSummaryLookups(
    context,
    [context.snapshot],
    raw.flatMap((entry) =>
      entry.fields.map(({ field, before, after }) => ({ field, values: [before, after] })),
    ),
  );
  return raw.map((entry) => withSummaries(entry, lookupsFor(entry.locale)));
};

const shippedPlan = async (context: ChangeSetServiceContext, draft: SchemaDraftRow) => {
  const revision =
    draft.base_version === null
      ? undefined
      : await schemaModelsRepository.findRevisionByVersion(
          draft.definition_id,
          draft.base_version,
          context.db,
        );
  const before = revision ? readStoredDefinition(revision.definition) : null;
  const planned: DraftPlan = {
    draft,
    before,
    ...(await planShippedDraft(context, draft, before)),
    activeVersion: context.snapshot.byId.get(draft.definition_id)?.version ?? null,
    stale: false,
    issues: [],
  };
  return { planned, beforeRevisionId: revision?.id ?? null };
};

const shippedSchemaItem = (
  { planned, beforeRevisionId }: Awaited<ReturnType<typeof shippedPlan>>,
  items: readonly ChangeSetItemRow[],
): ReviewSchemaItem => ({
  itemId: items.find((item) => item.schema_draft_id === planned.draft.id)?.id ?? '',
  draftId: planned.draft.id,
  definitionId: planned.draft.definition_id,
  category: categoryOfKind(planned.draft.kind),
  apiKey: planned.draft.api_key,
  operation: operationOf(planned.draft),
  baseVersion: planned.draft.base_version,
  activeVersion: planned.activeVersion,
  stale: false,
  plan: planned.plan,
  impact: null,
  affectedEntriesBySite: [],
  issues: [],
  alsoChangedIn: [],
  beforeRevisionId,
});

export const getShippedReview = async (
  context: ChangeSetServiceContext,
  { row, changeSet, items }: ShippedSet,
): Promise<ChangeSetReview> => {
  const seq = row.shipped_seq === null ? null : Number(row.shipped_seq);
  const drafts = await schemaDraftsRepository.listForSet(row.id, context.db);
  const schemaPlans = await Promise.all(drafts.map((draft) => shippedPlan(context, draft)));
  const plans = schemaPlans.map(({ planned }) => planned);
  return {
    changeSet,
    entries: await shippedEntries(
      context,
      seq,
      items.filter((item) => item.kind === 'entry'),
    ),
    schema: schemaPlans.map((planned) => shippedSchemaItem(planned, items)),
    notRestorable: notRestorableOf(row),
    consumers: await consumersFor(context, plans),
    usageDays: REVIEW_USAGE_DAYS,
    checks: {
      breaking: plans.some((planned) => planned.plan?.summary.breaking ?? false),
      destructive: plans.some((planned) => planned.plan?.summary.destructive ?? false),
      blocking: [],
      warnings: [],
    },
    notices: [],
  };
};
