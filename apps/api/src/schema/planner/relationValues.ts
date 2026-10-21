import {
  ANY_TARGET,
  createDefinitionIndex,
  isInterfaceDefinition,
  isModelDefinition,
  type DefinitionIndex,
  type FieldDefinition,
  type SchemaDefinition,
  type ValidationIssue,
} from '@shapio/schema';
import type { RelationValueQuery } from '../../repositories/relationEdgeCounts.js';

/**
 * Relation values a change would strand (plan interfaces, decision 9). A relation accepts the entries of its
 * target: a collection's family, an interface's members, or every collection and singleton (`*`). A change
 * can take a model out of that set without touching the relation itself: a type stops implementing an
 * interface, a member or a kind is deleted, a kind moves to another parent. Values pointing at that model's
 * entries would then fail the write check, so the change is refused while any exist (the person removes the
 * references first). A change to the relation's own target is the classifier's business instead: widening
 * keeps the values, narrowing clears them (an acknowledged destructive conversion).
 */

type RelationField = { owner: SchemaDefinition; field: FieldDefinition<'relation'> };

/** One model leaving one target, with the unchanged relation fields that target it. */
export type LeavingModel = { target: string; modelId: string; fields: RelationField[] };

/** Relation fields that can hold values: on models and components (an interface's contract stores nothing). */
const relationFieldsOf = (definitions: readonly SchemaDefinition[]): RelationField[] =>
  definitions
    .filter((definition) => !isInterfaceDefinition(definition))
    .flatMap((owner) =>
      owner.fields.flatMap((field) => (field.type === 'relation' ? [{ owner, field }] : [])),
    );

/** The models a relation target accepts in a schema (an unknown target accepts nothing). */
const acceptedBy = (
  index: DefinitionIndex,
  definitions: readonly SchemaDefinition[],
  target: string,
): ReadonlySet<string> => {
  if (target === ANY_TARGET) {
    return new Set(definitions.filter(isModelDefinition).map((definition) => definition.id));
  }
  const definition = index.get(target);
  if (!definition) {
    return new Set();
  }
  return new Set(isInterfaceDefinition(definition) ? index.implementedBy(target) : index.family(target));
};

/**
 * Every model a relation target accepted before the change and no longer accepts after it, for relation
 * fields that exist on both sides with the same target. `before` and `after` are whole schemas (stored
 * definitions, network-wide).
 */
export const leavingModels = (
  before: readonly SchemaDefinition[],
  after: readonly SchemaDefinition[],
): LeavingModel[] => {
  const targetsBefore = new Map(
    relationFieldsOf(before).map(({ field }) => [field.id, field.settings.target]),
  );
  const byTarget = new Map<string, RelationField[]>();
  for (const relation of relationFieldsOf(after)) {
    const { target } = relation.field.settings;
    if (targetsBefore.get(relation.field.id) === target) {
      byTarget.set(target, [...(byTarget.get(target) ?? []), relation]);
    }
  }
  if (byTarget.size === 0) {
    return [];
  }
  const indexBefore = createDefinitionIndex(before);
  const indexAfter = createDefinitionIndex(after);
  return [...byTarget].flatMap(([target, fields]) => {
    // A target deleted by the change is a reference error (REFERENCED_DEFINITION), reported by validation.
    if (target !== ANY_TARGET && !indexAfter.get(target)) {
      return [];
    }
    const kept = acceptedBy(indexAfter, after, target);
    return [...acceptedBy(indexBefore, before, target)]
      .filter((modelId) => !kept.has(modelId))
      .map((modelId) => ({ target, modelId, fields }));
  });
};

const nameOf = (definitions: readonly SchemaDefinition[], id: string) =>
  definitions.find((definition) => definition.id === id)?.apiKey ?? id;

const targetName = (definitions: readonly SchemaDefinition[], target: string) =>
  target === ANY_TARGET ? 'any entry' : `"${nameOf(definitions, target)}"`;

/**
 * One `RELATION_VALUES_EXIST` issue per leaving model whose entries some relation still holds, with the count
 * of entries holding them. `count` reads content (`relationEdgeCounts.countReferringEntries`).
 */
export const relationValueIssues = async (
  before: readonly SchemaDefinition[],
  after: readonly SchemaDefinition[],
  count: (query: RelationValueQuery) => Promise<number>,
): Promise<ValidationIssue[]> => {
  const issues: ValidationIssue[] = [];
  for (const leaving of leavingModels(before, after)) {
    const entries = await count({
      fieldIds: leaving.fields.map(({ field }) => field.id),
      targetModelIds: [leaving.modelId],
    });
    if (entries === 0) {
      continue;
    }
    const model = nameOf(before, leaving.modelId);
    const through = [...new Set(leaving.fields.map(({ owner, field }) => `${owner.apiKey}.${field.apiKey}`))]
      .map((name) => `"${name}"`)
      .join(', ');
    issues.push({
      path: '',
      code: 'RELATION_VALUES_EXIST',
      message: `${entries} ${entries === 1 ? 'entry still relates' : 'entries still relate'} to "${model}" entries through ${through} (a relation to ${targetName(before, leaving.target)}), which would no longer accept them; remove those references first`,
      definitionId: leaving.modelId,
    });
  }
  return issues;
};

/**
 * The `RELATION_VALUES_EXIST` issues of one definition's change (`after` null: its deletion) against a whole
 * schema, counted on the database: what the admin's plan preview and a change set's review show before the
 * activation refuses it under the lock.
 */
export const changeRelationValueIssues = (
  schema: readonly SchemaDefinition[],
  definitionId: string,
  after: SchemaDefinition | null,
  count: (query: RelationValueQuery) => Promise<number>,
): Promise<ValidationIssue[]> =>
  relationValueIssues(
    schema,
    [...schema.filter((definition) => definition.id !== definitionId), ...(after ? [after] : [])],
    count,
  );
