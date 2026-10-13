import {
  classifyChanges,
  diffDefinitions,
  findChildDefinitions,
  findDependentModels,
  findReferencingDefinitions,
  summarizeChanges,
  type ChangeSummary,
  type ClassifiedChange,
  type FieldDefinition,
  type JsonValue,
  type SchemaDefinition,
  type ValidationIssue,
  uniqueFieldsChangingLocalization,
} from '@shapio/schema';
import { fieldIndexName, hasFieldIndex, type FieldIndexSpec } from '../../content/compiler/expressions.js';
import { maxFieldIndexes } from '../../db/limits.js';
import { validateScoped, type ScopedDefinition } from '../scopedValidation.js';
import { memberChanges, resolveSchema, type MemberChange, type ResolvedSchema } from './family.js';
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

/**
 * The content steps of one change of `after` (a member of the changed model's family, or the changed
 * component). `ownerId` is the definition the plan is for: the content ports load the proposed schema
 * through it, so a family member's steps name the changed model while their locations name the member.
 */
const contentStepsFor = (
  change: ClassifiedChange,
  before: SchemaDefinition | null,
  after: SchemaDefinition,
  proposed: readonly SchemaDefinition[],
  ownerId: string = after.id,
): ContentStep[] => {
  const locations = () => findValueLocations(proposed, after.id);
  const owner = ownerId === after.id ? {} : { ownerId };
  const target = field(after, change.fieldId);
  return change.prerequisites.flatMap((kind): ContentStep[] => {
    switch (kind) {
      case 'validateRequired':
        return target
          ? [{ kind, ownerId, fieldId: target.id, locations: locations(), fieldApiKey: target.apiKey }]
          : [];
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
        if (after.kind === 'component') {
          return [];
        }
        if (change.kind === 'model.localized') {
          // One check per unique field whose values move between per-locale and shared storage.
          return uniqueFieldsChangingLocalization(before, after).map((unique) => ({
            kind,
            modelId: after.id,
            fieldId: unique.id,
            ...owner,
          }));
        }
        return target ? [{ kind, modelId: after.id, fieldId: target.id, ...owner }] : [];
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

/**
 * Models whose entries a change affects: a model's family (it and every model extending it, before and
 * after the change), or every model embedding a component, directly, through components or by inheritance.
 */
const affectedModelsOf = (
  definition: SchemaDefinition,
  active: ResolvedSchema,
  proposed: ResolvedSchema,
): string[] =>
  definition.kind === 'component'
    ? [
        ...new Set(
          [active, proposed].flatMap((schema) =>
            findDependentModels(schema.stored, definition.id).map((model) => model.id),
          ),
        ),
      ]
    : [...new Set([...active.index.family(definition.id), ...proposed.index.family(definition.id)])];

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
  // The field may be inherited (a child's index of its parent's field): then the issue names no field path.
  const position = after.fields.findIndex((candidate) => candidate.id === newIndexes[0]?.fieldId);
  const flag = after.fields[position]?.filterable ? 'filterable' : 'sortable';
  return [
    {
      path: position === -1 ? '/fields' : `/fields/${position}/${flag}`,
      code: 'UNSUPPORTED_FLAG',
      message: `MySQL can index at most ${limit} filterable or sortable fields across all models of all sites (InnoDB allows 64 indexes per table); this change would need ${total}. Clear "filterable" or "sortable" on fields that do not need it.`,
      definitionId: after.id,
    },
  ];
};

const deletionIssues = (
  definition: SchemaDefinition,
  active: readonly SchemaDefinition[],
): ValidationIssue[] => [
  ...findReferencingDefinitions(active, definition.id).map((referrer) => ({
    path: '',
    code: 'REFERENCED_DEFINITION' as const,
    message: `"${referrer.apiKey}" still references "${definition.apiKey}"; remove the reference first`,
    definitionId: referrer.id,
  })),
  ...findChildDefinitions(active, definition.id).map((child) => ({
    path: '',
    code: 'HAS_CHILDREN' as const,
    message: `"${child.apiKey}" extends "${definition.apiKey}"; delete it or move it under another type first`,
    definitionId: definition.id,
  })),
];

/** Steps of several family members for one field: one step whose locations cover every member. */
const mergeLocations = (steps: readonly ContentStep[]): ContentStep[] => {
  const merged = new Map<string, ContentStep>();
  for (const step of steps) {
    const key = stepKey(step);
    const seen = merged.get(key);
    if (!seen) {
      merged.set(key, step);
    } else if ('locations' in seen && 'locations' in step) {
      merged.set(key, { ...seen, locations: [...seen.locations, ...step.locations] });
    }
  }
  return [...merged.values()];
};

/** Index work of every member: builds of new indexes (gating when the member has content), drops of old ones. */
const indexWorkOf = (members: readonly MemberChange[]) => {
  const prerequisites: IndexStep[] = [];
  const followUps: FollowUpStep[] = [];
  const created: IndexStep[] = [];
  for (const member of members) {
    const beforeIndexes = indexStepsOf(member.before);
    const afterIndexes = indexStepsOf(member.after);
    const newIndexes = afterIndexes.filter(
      (step) => !beforeIndexes.some((old) => old.indexName === step.indexName),
    );
    created.push(...newIndexes);
    // With no content (a brand-new model), nothing can fail a check: indexes are built right after
    // activation instead of gating it.
    (member.hasContent ? prerequisites : followUps).push(...newIndexes);
    // The layout before sites too: the index may not have been rebuilt yet (the fieldIndexLayout job).
    followUps.push(
      ...beforeIndexes
        .filter((step) => !afterIndexes.some((kept) => kept.indexName === step.indexName))
        .flatMap((step): FollowUpStep[] => [
          { kind: 'dropIndex', indexName: step.indexName },
          { kind: 'dropIndex', indexName: fieldIndexName(indexSpecOf(step), 1) },
        ]),
    );
  }
  return { prerequisites, followUps, created };
};

/** Unique-registry rows to release, per field, scoped to the members that lose its uniqueness. */
const releasedUniqueOf = (
  members: ReadonlyArray<Pick<MemberChange, 'modelId' | 'changes'>>,
): FollowUpStep[] => {
  const byField = new Map<string, string[]>();
  for (const member of members) {
    for (const change of member.changes) {
      if (change.cleanup.includes('releaseUnique') && change.fieldId) {
        byField.set(change.fieldId, [...(byField.get(change.fieldId) ?? []), member.modelId]);
      }
    }
  }
  return [...byField].map(([fieldId, modelIds]) => ({
    kind: 'releaseUnique',
    fieldId,
    modelIds: [...new Set(modelIds)],
  }));
};

/**
 * Content steps of every member that may hold entries, merged per field and put in phase order. A model's
 * steps name it as their owner; a family member's locations name the member.
 */
const familyContentSteps = (
  members: readonly MemberChange[],
  ownerId: string,
  proposed: readonly SchemaDefinition[],
): ContentStep[] =>
  byPhase(
    mergeLocations(
      members.flatMap((member) =>
        member.after && member.hasContent
          ? member.changes.flatMap((change) =>
              contentStepsFor(change, member.before, member.after as SchemaDefinition, proposed, ownerId).map(
                (step) => markRebuild(step, member.before),
              ),
            )
          : [],
      ),
    ),
  );

/**
 * Plans one change. Validation runs in every view the change touches (`validateScoped`); everything about
 * content (affected models, value locations, index counts) runs on the full set, because a shared component
 * is embedded by models of every site and MySQL's index cap is per table, across all sites. Content work
 * reads resolved definitions (effective fields): a change to a model that others extend is planned for
 * every family member (plan polymorphic-types, decision 5), and a component embedded by inheritance is
 * found in every model that inherits it.
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
  const active = resolveSchema(scopedActive.map((entry) => entry.definition));
  const proposed = resolveSchema(scopedProposed.map((entry) => entry.definition));
  const changes = classifyChanges(diffDefinitions(before, after), { before, after });
  const issues = after
    ? validateScoped(scopedProposed, [siteId], siteKeys ? { siteKeys } : {})
    : deletionIssues(subject, active.stored);
  const affectedModelIds = affectedModelsOf(subject, active, proposed);

  // A component is one definition; a model is planned for its whole family.
  const members: MemberChange[] =
    subject.kind === 'component'
      ? []
      : memberChanges({ subjectId: subject.id, before, after, hasContent, active, proposed });
  const contentSteps =
    subject.kind === 'component'
      ? after && hasContent
        ? byPhase(changes.flatMap((change) => contentStepsFor(change, before, after, proposed.resolved)))
        : []
      : familyContentSteps(members, subject.id, proposed.resolved);
  const indexes = indexWorkOf(members);
  issues.push(...fieldIndexLimitIssues(after, indexes.created, proposed.resolved));
  const released =
    subject.kind === 'component'
      ? releasedUniqueOf([{ modelId: subject.id, changes }]).map((step) => ({
          ...step,
          modelIds: affectedModelIds,
        }))
      : releasedUniqueOf(members);
  const prerequisites = dedupe<PrerequisiteStep>([...contentSteps, ...indexes.prerequisites]);
  const followUps = dedupe<FollowUpStep>([...indexes.followUps, ...released]);

  return {
    definitionId: subject.id,
    kind: subject.kind,
    apiKey: subject.apiKey,
    operation: !after ? 'delete' : fromVersion === null ? 'create' : 'update',
    siteId,
    fromVersion,
    changes,
    // What the change does to every member counts: a re-parent that strips values is destructive.
    summary: summarizeChanges([...changes, ...members.flatMap((member) => member.changes)]),
    affectedModelIds,
    prerequisites,
    followUps,
    issues,
  };
};
