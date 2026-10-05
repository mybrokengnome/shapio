import {
  classifyChanges,
  diffDefinitions,
  findDependentModels,
  findReferencingDefinitions,
  summarizeChanges,
  type ChangeSummary,
  type ClassifiedChange,
  type FieldDefinition,
  type JsonValue,
  type SchemaDefinition,
  type ValidationIssue,
} from '@shapio/schema';
import { fieldIndexName, hasFieldIndex, type FieldIndexSpec } from '../../content/compiler/expressions.js';
import { maxFieldIndexes } from '../../db/limits.js';
import { validateScoped, type ScopedDefinition } from '../scopedValidation.js';
import {
  findValueLocations,
  stepKey,
  type ContentStep,
  type FollowUpStep,
  type IndexStep,
  type PrerequisiteStep,
} from './steps.js';

/**
 * The change planner (brief §5 steps 3–5): diff, classify, validate against the whole proposed schema and
 * derive the prerequisite and follow-up work. Pure: impact (which needs content) is added by impact.ts.
 */
export type ChangePlan = {
  definitionId: string;
  kind: SchemaDefinition['kind'];
  apiKey: string;
  operation: 'create' | 'update' | 'delete';
  /**
   * The definition's scope after the change: its site, or null when shared. Optional only because plans
   * stored before per-site schemas have none (every definition was shared then).
   */
  siteId?: string | null;
  /** The active per-model version the plan was made against; null when the definition is new. */
  fromVersion: number | null;
  changes: ClassifiedChange[];
  summary: ChangeSummary;
  /** Models whose entries are affected: the model itself, or every model embedding a component. */
  affectedModelIds: string[];
  prerequisites: PrerequisiteStep[];
  followUps: FollowUpStep[];
  /** Problems that make the change impossible; a plan with issues is never applied. */
  issues: ValidationIssue[];
};

export type PlanInput = {
  /** Current definition (active, or the last revision of a deleted one being restored); null if new. */
  before: SchemaDefinition | null;
  /** Proposed definition; null to delete. */
  after: SchemaDefinition | null;
  fromVersion: number | null;
  /** Every active definition right now, on every site, with its scope (the full set, never a view). */
  active: readonly ScopedDefinition[];
  /** The definition's scope: the site it belongs to, or null when shared. */
  siteId: string | null;
  /** True when content may exist for this definition (an existing or restored model). */
  hasContent: boolean;
  /** Site IDs to keys, to name the site in issues found in its view. */
  siteKeys?: ReadonlyMap<string, string>;
};

/** The field indexes a definition needs (filterable or sortable, not deprecated), in the current layout. */
export const indexStepsOf = (definition: SchemaDefinition | null): IndexStep[] =>
  definition && definition.kind !== 'component'
    ? definition.fields
        .filter((field: FieldDefinition) => hasFieldIndex(field))
        .map((field) => {
          // Toggling `localized` changes the layout, hence the name: the old index is dropped, a new one built.
          const spec = {
            modelId: definition.id,
            fieldId: field.id,
            type: field.type,
            localized: definition.localized,
          };
          return {
            kind: 'buildIndex',
            modelId: definition.id,
            fieldId: field.id,
            fieldType: field.type,
            localized: definition.localized,
            indexName: fieldIndexName(spec),
          };
        })
    : [];

/** The expression-module spec of an index step. */
export const indexSpecOf = (step: IndexStep): FieldIndexSpec => ({
  modelId: step.modelId,
  fieldId: step.fieldId,
  type: step.fieldType,
  ...(step.localized !== undefined ? { localized: step.localized } : {}),
});

const field = (definition: SchemaDefinition | null, fieldId: string | undefined) =>
  definition?.fields.find((candidate) => candidate.id === fieldId);

const contentStepsFor = (
  change: ClassifiedChange,
  after: SchemaDefinition,
  proposed: readonly SchemaDefinition[],
): ContentStep[] => {
  const ownerId = after.id;
  const locations = () => findValueLocations(proposed, ownerId);
  const target = field(after, change.fieldId);
  return change.prerequisites.flatMap((kind): ContentStep[] => {
    switch (kind) {
      case 'validateRequired':
        return target ? [{ kind, ownerId, fieldId: target.id, locations: locations() }] : [];
      case 'backfill':
        return target
          ? [
              {
                kind,
                ownerId,
                fieldId: target.id,
                value: target.defaultValue as JsonValue,
                locations: locations(),
              },
            ]
          : [];
      case 'validateValues':
        return [{ kind, ownerId, ...(target ? { fieldId: target.id } : {}), locations: locations() }];
      case 'checkUnique':
        return target && after.kind !== 'component' ? [{ kind, modelId: after.id, fieldId: target.id }] : [];
      case 'convert':
        return [{ kind, ownerId, change, locations: locations() }];
      default:
        // buildIndex is derived from the index layout below, not per change.
        return [];
    }
  });
};

/**
 * The order of content steps, whatever order the changes were listed in: conversions and backfills first,
 * then checks of single fields, and whole-entry validation last. The dry run applies the conversions and
 * backfills in this order in memory, so every check sees the values the activated schema will see (a
 * conversion's validation must include another change's backfill); a failure is reported under the first
 * failing step in this order.
 */
const CONTENT_STEP_PHASE: Record<ContentStep['kind'], number> = {
  convert: 0,
  backfill: 1,
  validateRequired: 2,
  checkUnique: 3,
  validateValues: 4,
};

const byPhase = (steps: readonly ContentStep[]): ContentStep[] =>
  steps
    .map((step, index) => ({ step, index }))
    .sort((a, b) => CONTENT_STEP_PHASE[a.step.kind] - CONTENT_STEP_PHASE[b.step.kind] || a.index - b.index)
    .map(({ step }) => step);

/** A uniqueness check on a field that is already unique stages its claims apart (see ContentStep). */
const markRebuild = (step: ContentStep, before: SchemaDefinition | null): ContentStep =>
  step.kind === 'checkUnique' && before?.fields.some((field) => field.id === step.fieldId && field.unique)
    ? { ...step, rebuild: true }
    : step;

const dedupe = <T extends PrerequisiteStep | FollowUpStep>(steps: readonly T[]): T[] => {
  const seen = new Set<string>();
  return steps.filter((step) => {
    const key = stepKey(step);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

/** The scope a plan's change lands in (null: shared; plans stored before per-site schemas are shared). */
export const scopeOfPlan = (plan: Pick<ChangePlan, 'siteId'>): string | null => plan.siteId ?? null;

const proposedSchema = (
  active: readonly ScopedDefinition[],
  definitionId: string,
  after: SchemaDefinition | null,
  siteId: string | null,
): ScopedDefinition[] => [
  ...active.filter((entry) => entry.definition.id !== definitionId),
  ...(after ? [{ definition: after, siteId }] : []),
];

const affectedModelsOf = (definition: SchemaDefinition, schema: readonly SchemaDefinition[]): string[] =>
  definition.kind === 'component'
    ? findDependentModels(schema, definition.id).map((model) => model.id)
    : [definition.id];

/**
 * MySQL indexes every filterable or sortable field on one table, which allows a fixed number of indexes
 * (`db/limits.ts`). A change that adds field indexes beyond that is refused; one that adds none is not, so
 * an instance already over the limit can still be edited.
 */
const fieldIndexLimitIssues = (
  after: SchemaDefinition | null,
  newIndexes: readonly IndexStep[],
  proposed: readonly SchemaDefinition[],
): ValidationIssue[] => {
  const limit = maxFieldIndexes();
  if (limit === undefined || !after || newIndexes.length === 0) {
    return [];
  }
  const total = proposed.reduce((sum, definition) => sum + indexStepsOf(definition).length, 0);
  if (total <= limit) {
    return [];
  }
  const position = after.fields.findIndex((candidate) => candidate.id === newIndexes[0]?.fieldId);
  const flag = after.fields[position]?.filterable ? 'filterable' : 'sortable';
  return [
    {
      path: `/fields/${position}/${flag}`,
      code: 'UNSUPPORTED_FLAG',
      message: `MySQL can index at most ${limit} filterable or sortable fields across all models of all sites (InnoDB allows 64 indexes per table); this change would need ${total}. Clear "filterable" or "sortable" on fields that do not need it.`,
      definitionId: after.id,
    },
  ];
};

const deletionIssues = (
  definition: SchemaDefinition,
  active: readonly SchemaDefinition[],
): ValidationIssue[] =>
  findReferencingDefinitions(active, definition.id).map((referrer) => ({
    path: '',
    code: 'REFERENCED_DEFINITION',
    message: `"${referrer.apiKey}" still references "${definition.apiKey}"; remove the reference first`,
    definitionId: referrer.id,
  }));

/**
 * Plans one change. Validation runs in every view the change touches (`validateScoped`); everything about
 * content (affected models, value locations, index counts) runs on the full set, because a shared component
 * is embedded by models of every site and MySQL's index cap is per table, across all sites.
 */
export const buildChangePlan = ({
  before,
  after,
  fromVersion,
  active: scopedActive,
  siteId,
  hasContent,
  siteKeys,
}: PlanInput): ChangePlan => {
  const subject = (after ?? before) as SchemaDefinition;
  const scopedProposed = proposedSchema(scopedActive, subject.id, after, siteId);
  const active = scopedActive.map((entry) => entry.definition);
  const proposed = scopedProposed.map((entry) => entry.definition);
  const changes = classifyChanges(diffDefinitions(before, after), { before, after });
  const issues = after
    ? validateScoped(scopedProposed, [siteId], siteKeys ? { siteKeys } : {})
    : deletionIssues(subject, active);
  const affectedModelIds = [
    ...new Set([...affectedModelsOf(subject, active), ...affectedModelsOf(subject, proposed)]),
  ];

  const beforeIndexes = indexStepsOf(before);
  const afterIndexes = indexStepsOf(after);
  const newIndexes = afterIndexes.filter(
    (step) => !beforeIndexes.some((old) => old.indexName === step.indexName),
  );
  // The layout before sites too: the index may not have been rebuilt yet (the fieldIndexLayout job).
  const droppedIndexes: FollowUpStep[] = beforeIndexes
    .filter((step) => !afterIndexes.some((kept) => kept.indexName === step.indexName))
    .flatMap((step) => [
      { kind: 'dropIndex', indexName: step.indexName },
      { kind: 'dropIndex', indexName: fieldIndexName(indexSpecOf(step), 1) },
    ]);
  const releasedUnique: FollowUpStep[] = changes
    .filter((change) => change.cleanup.includes('releaseUnique') && change.fieldId)
    .map((change) => ({ kind: 'releaseUnique', fieldId: change.fieldId as string }));

  // With no content (a brand-new definition), nothing can fail a check: indexes are built right after
  // activation instead of gating it.
  const contentSteps =
    after && hasContent
      ? byPhase(changes.flatMap((change) => contentStepsFor(change, after, proposed))).map((step) =>
          markRebuild(step, before),
        )
      : [];
  issues.push(...fieldIndexLimitIssues(after, newIndexes, proposed));
  const prerequisites = dedupe<PrerequisiteStep>([...contentSteps, ...(hasContent ? newIndexes : [])]);
  const followUps = dedupe<FollowUpStep>([
    ...(hasContent ? [] : newIndexes),
    ...droppedIndexes,
    ...releasedUnique,
  ]);

  return {
    definitionId: subject.id,
    kind: subject.kind,
    apiKey: subject.apiKey,
    operation: !after ? 'delete' : fromVersion === null ? 'create' : 'update',
    siteId,
    fromVersion,
    changes,
    summary: summarizeChanges(changes),
    affectedModelIds,
    prerequisites,
    followUps,
    issues,
  };
};
