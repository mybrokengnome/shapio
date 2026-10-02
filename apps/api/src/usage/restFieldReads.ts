import type { FieldDefinition } from '@shapio/schema';
import { selectFields } from '../content/compiler/select.js';
import type { PopulateTree } from '../content/compiler/types.js';
import { resolveModelById, type ContentModel } from '../content/model.js';
import type { Policy } from '../permissions/types.js';
import type { SchemaSnapshot } from '../schema/snapshot.js';
import type { FieldRead } from './aggregator.js';
import { relationFieldPath } from './keys.js';

/**
 * The fields a REST delivery response carried, as usage reads: the projected top-level fields (`explicit`
 * when the request named them with `fields`, `implicit` when it took the whole model) and, one level deep,
 * the fields of populated relation targets (always `implicit`: populate expands whole targets).
 */
export type RestReadShape = {
  snapshot: SchemaSnapshot;
  model: ContentModel;
  policy: Policy;
  query: { fields: readonly FieldDefinition[] | null; populate: PopulateTree };
  /** The caller's read policy for a relation's target model. */
  policyFor: (modelId: string) => Promise<Policy>;
};

export const restFieldReads = async ({
  snapshot,
  model,
  policy,
  query,
  policyFor,
}: RestReadShape): Promise<FieldRead[]> => {
  const fields = selectFields(model, policy.readMask, query.fields);
  const selection = query.fields === null ? 'implicit' : 'explicit';
  const reads: FieldRead[] = fields.map((field) => ({ path: field.id, selection }));
  for (const field of fields) {
    if (field.type !== 'relation' || !query.populate.has(field.id)) {
      continue;
    }
    const target = resolveModelById(snapshot, field.settings.target);
    if (!target) {
      continue;
    }
    const targetPolicy = await policyFor(target.definition.id);
    if (!targetPolicy.allowed) {
      continue;
    }
    for (const targetField of selectFields(target, targetPolicy.readMask, null)) {
      reads.push({ path: relationFieldPath(field.id, targetField.id), selection: 'implicit' });
    }
  }
  return reads;
};
