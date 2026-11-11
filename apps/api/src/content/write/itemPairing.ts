import type { ComponentDefinition, FieldDefinition } from '@shapio/schema';
import { ITEM_ID_KEY } from '../../constants/itemIds.js';
import type { ContentData } from '../../db/contentData.js';
import { pointer, type ContentIssue } from '../validator/issues.js';
import { componentOfItem, storedItemId, type CallerView, type ViewScope } from './callerView.js';
import {
  CARRY_MAX_ITEMS,
  itemIssueOf,
  NO_PAIRINGS,
  pairList,
  pairSingle,
  type FieldPairings,
  type Pairing,
} from './listPairing.js';

/**
 * The one pairing of every component value a write sends, in storage form, with today's definitions (plan
 * item-ids): which stored item each item continues, by the IDs the client sent, else by what the caller sees of
 * each item (`pairList`). Every question about what the caller sees is the caller view's (`callerView.ts`).
 * Writes through a schema version pair in the client's shape (`content/lens/write.ts`), asking the same view,
 * and hand their pairing to the carry-over the same way.
 */
export type ItemPairingResult = { pairings: FieldPairings; issues: ContentIssue[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The ID a sent instance names: a string, null (sent as new), or undefined (none sent). */
const sentIdOf = (item: unknown): string | null | undefined =>
  isRecord(item) && Object.hasOwn(item, ITEM_ID_KEY)
    ? typeof item[ITEM_ID_KEY] === 'string' && item[ITEM_ID_KEY] !== ''
      ? item[ITEM_ID_KEY]
      : null
    : undefined;

type Walk = { view: CallerView; issues: ContentIssue[] };

const pairInstance = (
  walk: Walk,
  scope: ViewScope,
  component: ComponentDefinition | undefined,
  written: unknown,
  stored: unknown,
  path: string,
): FieldPairings =>
  component ? pairFields(walk, scope, component.fields, written, stored, path, false) : NO_PAIRINGS;

const pairValue = (
  walk: Walk,
  scope: ViewScope,
  field: FieldDefinition,
  written: unknown,
  stored: unknown,
  path: string,
): Pairing | null => {
  const { view } = walk;
  if (field.type === 'component' && !field.settings.repeatable) {
    if (!isRecord(written)) {
      return null;
    }
    const base = isRecord(stored) ? stored : undefined;
    const { pairs, issues } = pairSingle(sentIdOf(written), storedItemId(base), base !== undefined);
    walk.issues.push(...issues.map((issue) => itemIssueOf(issue, path)));
    return {
      pairs,
      inside: [
        pairInstance(
          walk,
          scope,
          view.componentOf(field.settings.component),
          written,
          pairs[0] === 0 ? base : undefined,
          path,
        ),
      ],
    };
  }
  if ((field.type !== 'component' && field.type !== 'dynamiczone') || !Array.isArray(written)) {
    return null;
  }
  const kept = Array.isArray(stored) ? stored.slice(0, CARRY_MAX_ITEMS) : [];
  const componentOf = (item: unknown) => componentOfItem(field, item, view.componentOf);
  const policy = {
    hidden: view.holdsHidden(scope, field),
    unseen: !scope.sees,
    neverRefuses: view.access.neverRefuses,
  };
  // Keys are made only where the caller sees the items: anywhere else nothing is compared.
  const compares = scope.sees && written.every((item) => sentIdOf(item) === undefined);
  const { pairs, issues } = pairList(
    {
      sentIds: written.map(sentIdOf),
      sent: {
        keys: compares ? written.map((item) => view.sentKey(scope, componentOf(item), item)) : [],
        kinds: written.map((item) => componentOf(item)?.id ?? null),
      },
      storedIds: kept.map(storedItemId),
      stored: {
        keys: compares ? kept.map((item) => view.storedKey(scope, componentOf(item), item)) : [],
        kinds: kept.map((item) => componentOf(item)?.id ?? null),
      },
    },
    policy,
  );
  walk.issues.push(...issues.map((issue) => itemIssueOf(issue, path, { unseen: policy.unseen })));
  return {
    pairs,
    inside: written.map((item, index) => {
      const pair = pairs[index] ?? -1;
      return pairInstance(
        walk,
        scope,
        componentOf(item),
        item,
        pair === -1 ? undefined : kept[pair],
        pointer(path, index),
      );
    }),
  };
};

const pairFields = (
  walk: Walk,
  scope: ViewScope,
  fields: readonly FieldDefinition[],
  written: unknown,
  stored: unknown,
  path: string,
  topLevel: boolean,
): FieldPairings => {
  if (!isRecord(written)) {
    return NO_PAIRINGS;
  }
  const pairings = new Map<string, Pairing>();
  for (const field of fields) {
    if ((field.type === 'component' || field.type === 'dynamiczone') && field.id in written) {
      const pairing = pairValue(
        walk,
        walk.view.inside(scope, field, topLevel),
        field,
        written[field.id],
        isRecord(stored) ? stored[field.id] : undefined,
        pointer(path, field.apiKey),
      );
      if (pairing) {
        pairings.set(field.id, pairing);
      }
    }
  }
  return pairings;
};

/**
 * The pairing of every component value in `patch` (storage form, IDs the client sent under `__id`) with
 * `base` (what the write starts from, every instance with its ID: `withItemIds`), and the refusals it makes
 * (`CONTENT_INVALID` issues, paths in today's API IDs).
 */
export const pairComponentItems = (
  patch: Readonly<ContentData>,
  base: Readonly<ContentData>,
  fields: readonly FieldDefinition[],
  view: CallerView,
): ItemPairingResult => {
  const walk: Walk = { view, issues: [] };
  const pairings = pairFields(walk, view.top, fields, patch, base, '', true);
  return { pairings, issues: walk.issues };
};
