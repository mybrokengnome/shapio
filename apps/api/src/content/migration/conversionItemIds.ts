import type { ContentData } from '../../db/contentData.js';
import type { SchemaById } from '../../schema/snapshot.js';
import { componentLookupOf, itemIdScopeOf, withItemIds } from '../itemIds.js';
import { resolveModelById } from '../model.js';
import { sameContent } from '../sameContent.js';
import { withUniqueItemIds } from '../write/itemIdUniqueness.js';

/**
 * Item IDs across a schema change (plan item-ids). An instance stored without an ID reads with one derived
 * from the schema (its field's shape, whether the field and the content type are localized) and its stored
 * content. A change that moves either would give it another ID, different in a draft and its published version
 * when only one of them is converted, and unknown to a client that read the old one. So an activation persists,
 * for every head it rewrites, the IDs its instances read with under the active schema before converting, and a
 * conversion carries them into the new shape.
 */
export type ConversionItemIds = {
  key: Buffer;
  /** The schema reads used until the activation. */
  active: SchemaById;
  /** The schema the activation makes active. */
  proposed: SchemaById;
};

type HeadData = { entry_id: string; model_id: string; locale: string; data: ContentData };

/** `head`'s data with every instance's ID as a read under `schema` gives it (stored, or derived). */
const idsUnder = (schema: SchemaById, key: Buffer, head: HeadData): ContentData => {
  const model = resolveModelById(schema, head.model_id);
  return model
    ? withItemIds(
        head.data,
        model.definition.fields,
        componentLookupOf(model.components),
        itemIdScopeOf(key, head.entry_id, model, head.locale),
      )
    : head.data;
};

/** The head's data with the IDs its instances read with before the change, persisted. */
export const idsBefore = (ids: ConversionItemIds, head: HeadData): ContentData =>
  idsUnder(ids.active, ids.key, head);

/** Whether an instance of the head (as stored) would read with another ID once the change is active. */
export const itemIdsMove = (ids: ConversionItemIds, head: HeadData): boolean => {
  const before = idsBefore(ids, head);
  // Every ID stored: nothing is derived, so nothing can move.
  return !sameContent(before, head.data) && !sameContent(before, idsUnder(ids.proposed, ids.key, head));
};

/**
 * The data a rewritten head stores: its converted data, with an ID on every instance (one a conversion or a
 * backfill made gets the ID a read would derive for it, the same in a draft and its published version) and
 * every ID unique.
 */
export const idsAfter = (ids: ConversionItemIds, head: HeadData): ContentData => {
  const model = resolveModelById(ids.proposed, head.model_id);
  const data = idsUnder(ids.proposed, ids.key, head);
  return model ? withUniqueItemIds(data, model.definition.fields, componentLookupOf(model.components)) : data;
};
