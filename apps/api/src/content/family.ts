import type { Policy } from '../permissions/types.js';
import type { SchemaById } from '../schema/snapshot.js';
import { modelRouteOf, resolveModelById, type ContentModel } from './model.js';

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

/** A member of a read (a family's kind, an interface's member) a caller may read, with its policy. */
export type ReadMember = { model: ContentModel; policy: Policy };

/**
 * The models among `modelIds` the caller may read, each with its own policy, in the given order: a family
 * (`familyIdsOf`, the route's model first), an interface's members, or the models a relation's values belong
 * to (plan interfaces). A model the caller may not read, or that is not a collection or singleton of the view,
 * is left out (never a 403: the caller asked for a set). `known` is reused for its own ID instead of being
 * resolved again (the route's model, already resolved).
 */
export const readableMembers = async (
  snapshot: SchemaById,
  modelIds: readonly string[],
  policyFor: (modelId: string) => Promise<Policy>,
  known?: ContentModel,
): Promise<ReadMember[]> => {
  const models = modelIds.flatMap((id) =>
    known !== undefined && id === known.definition.id ? [known] : (resolveModelById(snapshot, id) ?? []),
  );
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

/** One kind of a family list, for `meta.kinds`. */
export type KindMeta = { apiKey: string; label: string; parent: string | null; routeKey: string };

/**
 * The kinds a family list covers, in tree order (the route's model, then each kind before its own kinds):
 * the members the caller may read. Undefined for a model without kinds, so its responses do not change.
 */
export const kindsMetaOf = (
  snapshot: SchemaById,
  route: ContentModel,
  members: readonly ReadMember[],
): KindMeta[] | undefined => {
  if (snapshot.childrenOf(route.definition.id).length === 0) {
    return undefined;
  }
  return members.map(({ model }) => {
    const parentId = model.definition.extends;
    return {
      apiKey: model.definition.apiKey,
      label: model.definition.label,
      parent: parentId === undefined ? null : (snapshot.byId.get(parentId)?.definition.apiKey ?? null),
      routeKey: model.route?.key ?? modelRouteOf(snapshot, model.definition).key,
    };
  });
};
