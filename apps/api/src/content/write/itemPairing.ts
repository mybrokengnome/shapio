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
  shownCounterparts,
  shownItemsAt,
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
  shown: readonly unknown[],
  path: string,
): FieldPairings =>
  component
    ? pairFields(
        walk,
        walk.view.within(scope, isRecord(stored)),
        component.fields,
        written,
        stored,
        shown,
        path,
        false,
      )
    : NO_PAIRINGS;

const pairValue = (
  walk: Walk,
  scope: ViewScope,
  field: FieldDefinition,
  written: unknown,
  stored: unknown,
  shown: readonly unknown[],
  path: string,
): Pairing | null => {
  const { view } = walk;
  // What another head the caller may read shows here (`shownElsewhere` in listPairing.ts), by item ID.
  const shownHere = shownItemsAt(shown, scope.reads);
  const policy = {
    hidden: view.holdsHidden(scope, field),
    unseen: !scope.sees,
    neverRefuses: view.access.neverRefuses,
    fresh: scope.fresh === true,
    readsDrafts: view.access.readsDrafts === true,
  };
  if (field.type === 'component' && !field.settings.repeatable) {
    if (!isRecord(written)) {
      return null;
    }
    const base = isRecord(stored) ? stored : undefined;
    const sentId = sentIdOf(written);
    const { pairs, issues } = pairSingle(sentId, storedItemId(base), base !== undefined, {
      ids: new Set(shownHere.keys()),
      policy,
    });
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
          shownCounterparts(shownHere, sentId, pairs[0] === 0 ? base : undefined),
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
  // Keys are made only for a list sent without IDs: where the caller sees the items, of what it sees; where it
  // does not, of whole items, and only for a list it writes in full (one that can hold more is never compared).
  // A list that names IDs only another head shows gets them too where the caller sees the items and nothing in
  // them is hidden from it (or an admin writes): those items pair as they would without IDs (listPairing.ts).
  const noIds = written.every((item) => sentIdOf(item) === undefined);
  const storedIds = new Set(kept.map(storedItemId));
  const copiesItems =
    !noIds &&
    scope.sees &&
    (!policy.hidden || policy.neverRefuses) &&
    written.some((item) => {
      const id = sentIdOf(item);
      return typeof id === 'string' && !storedIds.has(id) && shownHere.has(id);
    });
  const keyOf = copiesItems
    ? { sent: view.sentKey, stored: view.storedKey }
    : !noIds
      ? null
      : scope.sees
        ? { sent: view.sentKey, stored: view.storedKey }
        : policy.hidden
          ? null
          : {
              sent: (_scope: ViewScope, component: ComponentDefinition | undefined, item: unknown) =>
                view.wholeKey(component, item),
              stored: (_scope: ViewScope, component: ComponentDefinition | undefined, item: unknown) =>
                view.wholeKey(component, item),
            };
  const { pairs, issues } = pairList(
    {
      sentIds: written.map(sentIdOf),
      sent: {
        keys: keyOf ? written.map((item) => keyOf.sent(scope, componentOf(item), item)) : [],
        kinds: written.map((item) => componentOf(item)?.id ?? null),
      },
      storedIds: kept.map(storedItemId),
      stored: {
        keys: keyOf ? kept.map((item) => keyOf.stored(scope, componentOf(item), item)) : [],
        kinds: kept.map((item) => componentOf(item)?.id ?? null),
      },
      shownIds: new Set(shownHere.keys()),
    },
    policy,
  );
  walk.issues.push(...issues.map((issue) => itemIssueOf(issue, path, { unseen: policy.unseen })));
  return {
    pairs,
    inside: written.map((item, index) => {
      const pair = pairs[index] ?? -1;
      const continued: unknown = pair === -1 ? undefined : kept[pair];
      return pairInstance(
        walk,
        scope,
        componentOf(item),
        item,
        continued,
        shownCounterparts(shownHere, sentIdOf(item), continued),
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
  shown: readonly unknown[],
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
        shown.map((head) => (isRecord(head) ? head[field.id] : undefined)),
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
 * (`CONTENT_INVALID` issues, paths in today's API IDs). `shown`: the other heads the caller may read on its
 * route, every instance with its ID, whose IDs are never unknown to it (`shownElsewhere` in listPairing.ts).
 */
export const pairComponentItems = (
  patch: Readonly<ContentData>,
  base: Readonly<ContentData>,
  fields: readonly FieldDefinition[],
  view: CallerView,
  shown: ReadonlyArray<Readonly<ContentData>> = [],
): ItemPairingResult => {
  const walk: Walk = { view, issues: [] };
  const pairings = pairFields(walk, view.top, fields, patch, base, shown, '', true);
  return { pairings, issues: walk.issues };
};
