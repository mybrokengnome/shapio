import {
  classifyChanges,
  createDefinitionIndex,
  diffDefinitions,
  isModelDefinition,
  resolveModelDefinition,
  type ClassifiedChange,
  type DefinitionIndex,
  type ResolvedModelDefinition,
  type SchemaDefinition,
} from '@shapio/schema';

/**
 * Planning a change to a model that others extend (plan polymorphic-types, decision 5). Stored definitions
 * hold their own fields, so a parent edit changes one definition while every descendant's effective shape
 * changes with it. The planner diffs each family member's resolved definition before and after the change
 * and derives content steps, indexes and cleanups per member; the stored diff of the changed definition
 * stays the plan's `changes` for review.
 */

/** A schema with every model resolved (effective fields); components as they are. */
export type ResolvedSchema = {
  index: DefinitionIndex;
  /** Stored definitions, as given. */
  stored: readonly SchemaDefinition[];
  /** The same definitions with models resolved: what content steps, locations and indexes read. */
  resolved: readonly SchemaDefinition[];
  /** Field IDs some definition declares itself. */
  declaredFieldIds: ReadonlySet<string>;
};

export const resolveSchema = (definitions: readonly SchemaDefinition[]): ResolvedSchema => {
  const index = createDefinitionIndex(definitions);
  return {
    index,
    stored: definitions,
    resolved: definitions.map((definition) =>
      isModelDefinition(definition) ? (index.resolve(definition.id) ?? definition) : definition,
    ),
    declaredFieldIds: new Set(
      definitions.flatMap((definition) => definition.fields.map((field) => field.id)),
    ),
  };
};

/** One family member's side of a change. */
export type MemberChange = {
  modelId: string;
  before: ResolvedModelDefinition | null;
  after: ResolvedModelDefinition | null;
  /** Its resolved diff, classified (re-parent losses marked as dropping values). */
  changes: ClassifiedChange[];
  /** Whether the member may hold entries (it existed before the change). */
  hasContent: boolean;
};

/**
 * An inherited field a member loses while some definition still declares it (the member moved to another
 * parent): its values are stripped (decision 6), so no stale value can come back if it ever regains it. A
 * field its declaring model removes stays a plain removal, values kept, as for any model.
 */
const stripLostInherited = (
  change: ClassifiedChange,
  before: ResolvedModelDefinition | null,
  declaredAfter: ReadonlySet<string>,
): ClassifiedChange => {
  if (change.kind !== 'field.removed' || !change.fieldId || !declaredAfter.has(change.fieldId)) {
    return change;
  }
  const lost = before?.fields.find((field) => field.id === change.fieldId);
  if (lost?.inheritedFrom === undefined) {
    return change;
  }
  return {
    ...change,
    category: 'conversion',
    destructive: true,
    dropsValues: true,
    prerequisites: ['convert'],
  };
};

const resolvedOrNull = (
  definition: SchemaDefinition | null,
  lookup: (id: string) => SchemaDefinition | undefined,
) => (definition && isModelDefinition(definition) ? resolveModelDefinition(definition, lookup) : null);

/**
 * Every member of the changed model's family (before and after, the model first) with its resolved diff.
 * `before` may be a deleted definition being restored, which is not in the active set. A delete plans the
 * model alone: a model with children cannot be deleted.
 */
export const memberChanges = (input: {
  subjectId: string;
  before: SchemaDefinition | null;
  after: SchemaDefinition | null;
  hasContent: boolean;
  /** Definitions that exist now (`active` may include proposed ones); default: every one in `active`. */
  existingIds?: ReadonlySet<string> | undefined;
  active: ResolvedSchema;
  proposed: ResolvedSchema;
}): MemberChange[] => {
  const { subjectId, before, after, existingIds, active, proposed } = input;
  const ids = after
    ? [...new Set([...active.index.family(subjectId), ...proposed.index.family(subjectId)])]
    : [subjectId];
  return ids.map((modelId) => {
    const isSubject = modelId === subjectId;
    const memberBefore = isSubject
      ? resolvedOrNull(before, (id) => (id === modelId ? (before ?? undefined) : active.index.get(id)))
      : (active.index.resolve(modelId) ?? null);
    const memberAfter = isSubject
      ? resolvedOrNull(after, proposed.index.get)
      : (proposed.index.resolve(modelId) ?? null);
    const changes = classifyChanges(diffDefinitions(memberBefore, memberAfter), {
      before: memberBefore,
      after: memberAfter,
      index: { before: active.index, after: proposed.index },
    }).map((change) => stripLostInherited(change, memberBefore, proposed.declaredFieldIds));
    return {
      modelId,
      before: memberBefore,
      after: memberAfter,
      changes,
      hasContent: isSubject
        ? input.hasContent
        : (existingIds?.has(modelId) ?? active.index.get(modelId) !== undefined),
    };
  });
};
