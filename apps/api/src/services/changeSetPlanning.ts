import { parseDefinition, type SchemaDefinition, type ValidationIssue } from '@shapio/schema';
import type { SchemaDraftRow } from '../repositories/schemaDrafts.js';
import { buildChangePlan, type ChangePlan } from '../schema/planner/plan.js';
import { readStoredDefinition } from '../schema/storedDefinition.js';
import type { SchemaServiceContext } from './schemaAccess.js';
import { findDeletedDefinition } from './schemaDefinitions.js';

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

/** The active definitions with these drafts applied (deletions removed, proposals swapped in or added). */
export const proposedDefinitions = (
  active: readonly SchemaDefinition[],
  drafts: readonly SchemaDraftRow[],
): SchemaDefinition[] => {
  const byId = new Map(active.map((definition) => [definition.id, definition]));
  for (const draft of drafts) {
    const proposal = storedDraftDefinition(draft);
    if (proposal) {
      byId.set(draft.definition_id, proposal);
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
  const before =
    active?.definition ??
    (draft.definition === null ? null : await findDeletedDefinition(context, draft.definition_id));
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
  const plan = buildChangePlan({
    before,
    after,
    fromVersion: activeVersion,
    active: proposedDefinitions(
      context.snapshot.definitions.map((entry) => entry.definition),
      others.filter((other) => other.id !== draft.id),
    ),
    hasContent: before !== null,
  });
  return { ...base, after, plan, issues: [...plan.issues, ...unsupportedIssues(plan)] };
};

export const planDrafts = (context: SchemaServiceContext, drafts: readonly SchemaDraftRow[]) =>
  Promise.all(drafts.map((draft) => planDraft(context, draft, drafts)));
