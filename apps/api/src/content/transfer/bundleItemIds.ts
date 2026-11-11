import type { FieldDefinition } from '@shapio/schema';
import { ITEM_ID_KEY } from '../../constants/itemIds.js';
import { AppError } from '../../helpers/appError.js';
import { componentOfItem, type ComponentLookup } from '../itemIds.js';
import type { ContentModel } from '../model.js';
import { pointer } from '../validator/issues.js';
import type { EntryRecord } from './format.js';

/**
 * The item IDs (`__id`, plan item-ids) a bundle entry carries, checked before anything of it is written. Each
 * one names the component instance it sits on in every head and revision it appears in, so it is taken as the
 * bundle states it or the entry is refused: an ID that is not a string of 1 to 64 characters, or that a head
 * or revision gives to two instances, is `BUNDLE_INVALID` with its path. Never renewed: a renewal decided by
 * position could let a draft and its published version disagree on which item an ID names.
 */
const MAX_ITEM_ID_LENGTH = 64;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const invalidItemId = (entryId: string, path: string, problem: string) =>
  new AppError(400, 'BUNDLE_INVALID', `Entry ${entryId}: the item ID at ${path} ${problem}`, {
    entryId,
    path,
  });

type Visit = {
  fields: readonly FieldDefinition[];
  container: Readonly<Record<string, unknown>>;
  path: string;
};

/** The first problem with the item IDs of one head's or revision's data (storage form), or undefined. */
const itemIdProblemIn = (
  data: Readonly<Record<string, unknown>>,
  fields: readonly FieldDefinition[],
  componentOf: ComponentLookup,
  base: string,
): { path: string; problem: string } | undefined => {
  const seen = new Set<string>();
  const stack: Visit[] = [{ fields, container: data, path: base }];
  for (let visit = stack.pop(); visit; visit = stack.pop()) {
    for (const field of visit.fields) {
      if (field.type !== 'component' && field.type !== 'dynamiczone') {
        continue;
      }
      const held = visit.container[field.id];
      const at = pointer(visit.path, field.id);
      const items: Array<{ item: unknown; path: string }> = Array.isArray(held)
        ? held.map((item: unknown, index) => ({ item, path: pointer(at, index) }))
        : [{ item: held, path: at }];
      for (const { item, path } of items) {
        if (!isRecord(item)) {
          continue;
        }
        if (Object.hasOwn(item, ITEM_ID_KEY)) {
          const id = item[ITEM_ID_KEY];
          if (typeof id !== 'string' || id.length === 0 || id.length > MAX_ITEM_ID_LENGTH) {
            return { path: pointer(path, ITEM_ID_KEY), problem: 'must be a string of 1 to 64 characters' };
          }
          if (seen.has(id)) {
            return {
              path: pointer(path, ITEM_ID_KEY),
              problem: 'names another item of the same version too',
            };
          }
          seen.add(id);
        }
        const component = componentOfItem(field, componentOf, item);
        if (component) {
          stack.push({ fields: component.fields, container: item, path });
        }
      }
    }
  }
  return undefined;
};

/** Refuses a bundle entry whose heads or revisions carry an item ID that is malformed or given twice. */
export const assertBundleItemIds = (
  model: ContentModel,
  entry: EntryRecord,
  componentOf: ComponentLookup,
): void => {
  const fields = model.definition.fields;
  const sources = [
    ...entry.heads.map((head) => ({ data: head.data, base: `/${head.locale}/${head.state}` })),
    ...entry.revisions.map((revision, index) => ({ data: revision.data, base: `/revisions/${index}` })),
  ];
  for (const { data, base } of sources) {
    const found = itemIdProblemIn(data, fields, componentOf, base);
    if (found) {
      throw invalidItemId(entry.id, found.path, found.problem);
    }
  }
};
