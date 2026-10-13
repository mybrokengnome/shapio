import type { Policy } from '../permissions/types.js';
import type { SchemaById } from '../schema/snapshot.js';
import { resolveModelById, type ContentModel } from './model.js';

/**
 * Families (plan polymorphic-types): a model and every model that extends it, directly or not. Reading a
 * route reads its model's family; relations to a model accept any member; an entry may change kind within
 * its family. Members share their inherited fields' IDs, their localization and their publishing flags.
 */

/** The members of a model's family that are in the schema view: the model first, then its descendants. */
export const familyModels = (snapshot: SchemaById, model: ContentModel): ContentModel[] =>
  snapshot
    .family(model.definition.id)
    .flatMap((id) => (id === model.definition.id ? [model] : (resolveModelById(snapshot, id) ?? [])));

/** The family's model IDs (the model first). */
export const familyIdsOf = (snapshot: SchemaById, modelId: string): readonly string[] => {
  const family = snapshot.family(modelId);
  return family.length > 0 ? family : [modelId];
};

/** A family member a caller may read, with its policy. */
export type ReadMember = { model: ContentModel; policy: Policy };

/**
 * The members of the model's family the caller may read, each with its own policy, the model first when it is
 * readable. A member the caller may not read is left out (never a 403: the caller asked for the family).
 */
export const readableMembers = async (
  snapshot: SchemaById,
  model: ContentModel,
  policyFor: (modelId: string) => Promise<Policy>,
): Promise<ReadMember[]> => {
  const models = familyModels(snapshot, model);
  const policies = await Promise.all(models.map((member) => policyFor(member.definition.id)));
  return models.flatMap((member, index) => {
    const policy = policies[index] as Policy;
    return policy.allowed ? [{ model: member, policy }] : [];
  });
};

/** The member a row belongs to, by its `model_id`. */
export const memberOf = (members: readonly ReadMember[], modelId: string): ReadMember | undefined =>
  members.find((member) => member.model.definition.id === modelId);

/** Rows grouped by their member, in first-seen order; rows of a model not among the members are dropped. */
export const groupByMember = <T extends { model_id: string }>(
  members: readonly ReadMember[],
  rows: readonly T[],
): Array<{ member: ReadMember; rows: T[] }> => {
  const groups = new Map<string, { member: ReadMember; rows: T[] }>();
  for (const row of rows) {
    let group = groups.get(row.model_id);
    if (!group) {
      const member = memberOf(members, row.model_id);
      if (!member) {
        continue;
      }
      group = { member, rows: [] };
      groups.set(row.model_id, group);
    }
    group.rows.push(row);
  }
  return [...groups.values()];
};
