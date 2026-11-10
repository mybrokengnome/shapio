import type { FieldDefinition } from '@shapio/schema';
import { selectFields } from '../content/compiler/select.js';
import type { PopulateTree } from '../content/compiler/types.js';
import { resolveModelById, type ContentModel } from '../content/model.js';
import type { Policy } from '../permissions/types.js';
import type { RequestLens } from '../schema/lens/views.js';
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
  /**
   * A read through a schema version (plan schema-lenses): only these field IDs count, top level and populated
   * targets alike (the fields the client's version knows and that do not read null). The selection stays
   * `implicit` for a read without `fields`: the client asked for its whole model.
   */
  limitTo?: ReadonlySet<string>;
};

/**
 * The fields a read through `lens` may count for `model` and the targets of its populated relations: by
 * today's field ID, those the client's version knows and reads (never one that reads null because it is
 * gone or its values were dropped). Undefined without a lens: everything counts.
 */
export const lensReadLimit = (
  lens: RequestLens | undefined,
  snapshot: SchemaSnapshot,
  model: ContentModel,
  populate: PopulateTree,
): ReadonlySet<string> | undefined => {
  if (!lens) {
    return undefined;
  }
  const ids = [model.definition.id];
  for (const field of model.definition.fields) {
    if (field.type === 'relation' && populate.has(field.id)) {
      const target = resolveModelById(snapshot, field.settings.target);
      if (target) {
        ids.push(target.definition.id);
      }
    }
  }
  const limit = new Set<string>();
  for (const id of ids) {
    for (const field of lens.lensFor(id)?.fields ?? []) {
      if (field.kind !== 'null') {
        limit.add(field.fieldId);
      }
    }
  }
  return limit;
};

export const restFieldReads = async ({
  snapshot,
  model,
  policy,
  query,
  policyFor,
  limitTo,
}: RestReadShape): Promise<FieldRead[]> => {
  const counted = (field: FieldDefinition) => !limitTo || limitTo.has(field.id);
  const fields = selectFields(model, policy.readMask, query.fields).filter(counted);
  const selection = query.fields === null ? 'implicit' : 'explicit';
  const reads: FieldRead[] = fields.map((field) => ({ path: field.id, selection }));
  for (const field of fields) {
    if (field.type !== 'relation' || !query.populate.has(field.id)) {
      continue;
    }
    // A relation to an interface or to any entry (plan interfaces) populates targets of several models,
    // whose fields are counted where they are read as their own model's; only a model target counts here.
    const target = resolveModelById(snapshot, field.settings.target);
    if (!target) {
      continue;
    }
    const targetPolicy = await policyFor(target.definition.id);
    if (!targetPolicy.allowed) {
      continue;
    }
    for (const targetField of selectFields(target, targetPolicy.readMask, null).filter(counted)) {
      reads.push({ path: relationFieldPath(field.id, targetField.id), selection: 'implicit' });
    }
  }
  return reads;
};
