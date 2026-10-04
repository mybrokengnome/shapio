import { parseDefinition, type SchemaDefinition, type ValidationIssue } from '@shapio/schema';
import type { SchemaDraftRow } from '../repositories/schemaDrafts.js';
import { buildChangePlan, type ChangePlan } from '../schema/planner/plan.js';
import { scopedDefinitionsOf, type ScopedDefinition } from '../schema/scopedValidation.js';
import { readStoredDefinition } from '../schema/storedDefinition.js';
import type { SchemaServiceContext } from './schemaAccess.js';
import { findDeletedDefinition, plannerInputOf } from './schemaDefinitions.js';

/**
 * Planning a change set's schema drafts with the same planner as the builder and `schema apply`. Each draft
 * is planned against the active schema with the set's OTHER drafts applied, so a model and a component it
 * starts embedding can ship together and are validated as the schema they will form.
 */
export type DraftPlan = {
  draft: SchemaDraftRow;
  before: SchemaDefinition | null;
  /** The parsed, normalized proposal; null for a deletion (or when it does not parse). */
  after: SchemaDefinition | null;
  /** Null when the draft does not parse. */
  plan: ChangePlan | null;
  /** The definition's active version now (null: not active). */
  activeVersion: number | null;
  /** The active version moved since the draft was based on it. */
  stale: boolean;
  issues: ValidationIssue[];
};

/** A draft's proposed definition as stored (normalized when it was saved). */
export const storedDraftDefinition = (draft: SchemaDraftRow): SchemaDefinition | null =>
  draft.definition === null ? null : readStoredDefinition(draft.definition);

/**
 * A draft's scope: an existing definition keeps its own; a new one belongs to the change set's site unless
 * the draft creates a shared definition (`shared`). Drafts never change a scope.
 */
export const draftScopeOf = (
  context: SchemaServiceContext,
  draft: Pick<SchemaDraftRow, 'definition_id' | 'shared'>,
) => {
  const active = context.snapshot.network.byId.get(draft.definition_id);
  return active ? active.siteId : draft.shared ? null : context.snapshot.siteId;
};

/** The active definitions with these drafts applied (deletions removed, proposals swapped in or added). */
export const proposedDefinitions = (
  context: SchemaServiceContext,
  active: readonly ScopedDefinition[],
  drafts: readonly SchemaDraftRow[],
): ScopedDefinition[] => {
  const byId = new Map(active.map((entry) => [entry.definition.id, entry]));
  for (const draft of drafts) {
    const proposal = storedDraftDefinition(draft);
    if (proposal) {
      byId.set(draft.definition_id, { definition: proposal, siteId: draftScopeOf(context, draft) });
    } else {
      byId.delete(draft.definition_id);
    }
  }
  return [...byId.values()];
};

const unsupportedIssues = (plan: ChangePlan): ValidationIssue[] =>
  plan.summary.supported
    ? []
    : plan.changes
        .filter((change) => !change.supported)
        .map((change) => ({
          path: change.fieldId ? `/fields/${change.fieldId}` : '',
          code: 'INVALID_STRUCTURE' as const,
          message: `This change is not supported: ${change.kind}`,
        }));

/** Plans one draft; `others` are the set's other drafts (applied to the active schema it is checked in). */
export const planDraft = async (
  context: SchemaServiceContext,
  draft: SchemaDraftRow,
  others: readonly SchemaDraftRow[],
): Promise<DraftPlan> => {
  const active = context.snapshot.byId.get(draft.definition_id);
  const activeVersion = active?.version ?? null;
  if (!active && context.snapshot.network.byId.has(draft.definition_id)) {
    // Another site's definition: never this set's to change (prepareDraft refuses it; this covers a set
    // whose draft became that after a scope change).
    return {
      draft,
      before: null,
      after: null,
      plan: null,
      activeVersion,
      stale: true,
      issues: [{ path: '', code: 'INVALID_STRUCTURE', message: 'the definition belongs to another site' }],
    };
  }
  const siteId = draftScopeOf(context, draft);
  const before =
    active?.definition ??
    (draft.definition === null ? null : await findDeletedDefinition(context, draft.definition_id, siteId));
  const base = { draft, before, activeVersion, stale: draft.base_version !== activeVersion };
  let after: SchemaDefinition | null = null;
  if (draft.definition !== null) {
    const parsed = parseDefinition(draft.definition, before ? { previous: before } : {});
    if (!parsed.ok) {
      return { ...base, after: null, plan: null, issues: parsed.issues };
    }
    after = parsed.definition;
  } else if (!before) {
    return {
      ...base,
      after: null,
      plan: null,
      issues: [{ path: '', code: 'INVALID_STRUCTURE', message: 'the definition to delete is not active' }],
    };
  }
  const { siteKeys } = await plannerInputOf(context);
  const plan = buildChangePlan({
    before,
    after,
    fromVersion: activeVersion,
    active: proposedDefinitions(
      context,
      scopedDefinitionsOf(context.snapshot.network.definitions),
      others.filter((other) => other.id !== draft.id),
    ),
    siteId,
    hasContent: before !== null,
    siteKeys,
  });
  return { ...base, after, plan, issues: [...plan.issues, ...unsupportedIssues(plan)] };
};

export const planDrafts = (context: SchemaServiceContext, drafts: readonly SchemaDraftRow[]) =>
  Promise.all(drafts.map((draft) => planDraft(context, draft, drafts)));
