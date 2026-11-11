import type { ComponentDefinition, FieldDefinition } from '@shapio/schema';
import { ITEM_ID_KEY } from '../../constants/itemIds.js';
import type { ContentData } from '../../db/contentData.js';
import type { ComponentLookup } from '../itemIds.js';
import { COMPONENT_KEY, isMissingValue } from '../validator/index.js';
import { pointer, type ContentIssue } from '../validator/issues.js';
import { newAlignmentBudget, type AlignmentBudget } from './listAlignment.js';
import {
  CARRY_MAX_ITEMS,
  itemIssueOf,
  itemKey,
  NO_PAIRINGS,
  pairList,
  pairSingle,
  type FieldPairings,
  type ListPolicy,
  type Pairing,
} from './listPairing.js';

/**
 * The one pairing of every component value a write sends, in storage form, with today's definitions (plan
 * item-ids): which stored item each item continues, by the IDs the client sent, else by what the caller sees of
 * each item (`pairList`). Writes through a schema version pair in the client's shape instead
 * (`content/lens/write.ts`) and hand their pairing to the carry-over the same way.
 */
export type ItemView = {
  componentOf: ComponentLookup;
  /** A field whose value is part of what the caller sees of an item (its key). */
  seen: (field: FieldDefinition) => boolean;
  /** A field kept from the stored item when the caller leaves it out: a value it cannot see. */
  hidden: (field: FieldDefinition) => boolean;
  /** The caller cannot see the stored items (it may not read the entry, or not the draft written). */
  unseen: boolean;
  /**
   * Whether the caller reads a top-level field (its read mask). A list in a field it cannot read is one whose
   * items it cannot see: never compared by content, refused without IDs. Absent: every field.
   */
  topLevelReadable?: (field: FieldDefinition) => boolean;
};

export type ItemPairingResult = { pairings: FieldPairings; issues: ContentIssue[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A stored instance's ID; null when it has none. */
const idOf = (item: unknown): string | null =>
  isRecord(item) && typeof item[ITEM_ID_KEY] === 'string' ? item[ITEM_ID_KEY] : null;

/** The ID a sent instance names: a string, null (sent as new), or undefined (none sent). */
const sentIdOf = (item: unknown): string | null | undefined =>
  isRecord(item) && Object.hasOwn(item, ITEM_ID_KEY)
    ? typeof item[ITEM_ID_KEY] === 'string'
      ? item[ITEM_ID_KEY]
      : null
    : undefined;

const kindOf = (item: unknown): string | null =>
  isRecord(item) && typeof item[COMPONENT_KEY] === 'string' ? item[COMPONENT_KEY] : null;

/** The components a component or zone field can hold. */
export const componentsOfField = (
  field: FieldDefinition,
  componentOf: ComponentLookup,
): ComponentDefinition[] =>
  (field.type === 'component'
    ? [field.settings.component]
    : field.type === 'dynamiczone'
      ? field.settings.components
      : []
  ).flatMap((id) => componentOf(id) ?? []);

/**
 * Whether items of these components can hold, at any depth, a value the caller cannot see: from the schema
 * alone, never from what is stored (a refusal must never tell a caller anything about hidden values).
 */
export const holdsHidden = (
  components: readonly ComponentDefinition[],
  componentOf: ComponentLookup,
  hidden: (field: FieldDefinition) => boolean,
  seen: Set<string> = new Set(),
): boolean =>
  components.some((component) => {
    if (seen.has(component.id)) {
      return false;
    }
    seen.add(component.id);
    return component.fields.some(
      (field) =>
        hidden(field) || holdsHidden(componentsOfField(field, componentOf), componentOf, hidden, seen),
    );
  });

/** What the caller sees of an instance (storage form), at any depth: the content of its key. */
const seenOf = (view: ItemView, component: ComponentDefinition | undefined, item: unknown): unknown => {
  if (!component || !isRecord(item)) {
    return item;
  }
  const output: Record<string, unknown> = {};
  for (const field of component.fields) {
    const value = item[field.id];
    if (view.seen(field) && !isMissingValue(value)) {
      output[field.id] = seenValue(view, field, value);
    }
  }
  return output;
};

const seenValue = (view: ItemView, field: FieldDefinition, value: unknown): unknown => {
  if (field.type === 'component') {
    const component = view.componentOf(field.settings.component);
    return Array.isArray(value)
      ? value.map((item) => seenOf(view, component, item))
      : seenOf(view, component, value);
  }
  if (field.type === 'dynamiczone' && Array.isArray(value)) {
    return value.map((item: unknown) => {
      const kind = kindOf(item);
      return kind ? { kind, seen: seenOf(view, view.componentOf(kind), item) } : item;
    });
  }
  return value;
};

const keyOf = (view: ItemView, component: ComponentDefinition | undefined, item: unknown): string | null =>
  component && isRecord(item) ? itemKey({ kind: component.id, seen: seenOf(view, component, item) }) : null;

type Walk = {
  view: ItemView;
  issues: ContentIssue[];
  hiddenByField: Map<string, boolean>;
  budget: AlignmentBudget;
};

const listPolicyOf = (walk: Walk, field: FieldDefinition, unreadable: boolean): ListPolicy => {
  if (unreadable) {
    return { hidden: true, unseen: true };
  }
  let hidden = walk.hiddenByField.get(field.id);
  if (hidden === undefined) {
    hidden = holdsHidden(
      componentsOfField(field, walk.view.componentOf),
      walk.view.componentOf,
      walk.view.hidden,
    );
    walk.hiddenByField.set(field.id, hidden);
  }
  return { hidden, unseen: walk.view.unseen };
};

const pairInstance = (
  walk: Walk,
  component: ComponentDefinition | undefined,
  written: unknown,
  stored: unknown,
  path: string,
): FieldPairings => (component ? pairFields(walk, component.fields, written, stored, path) : NO_PAIRINGS);

const pairValue = (
  walk: Walk,
  field: FieldDefinition,
  written: unknown,
  stored: unknown,
  path: string,
  unreadable: boolean,
): Pairing | null => {
  const { componentOf } = walk.view;
  if (field.type === 'component' && !field.settings.repeatable) {
    if (!isRecord(written)) {
      return null;
    }
    const base = isRecord(stored) ? stored : undefined;
    const { pairs, issues } = pairSingle(sentIdOf(written), idOf(base), base !== undefined);
    walk.issues.push(...issues.map((issue) => itemIssueOf(issue, path)));
    const component = componentOf(field.settings.component);
    return {
      pairs,
      inside: [pairInstance(walk, component, written, pairs[0] === 0 ? base : undefined, path)],
    };
  }
  if ((field.type !== 'component' && field.type !== 'dynamiczone') || !Array.isArray(written)) {
    return null;
  }
  const zone = field.type === 'dynamiczone';
  const componentOfItem = (item: unknown) =>
    zone ? (componentOf(kindOf(item) ?? '') ?? undefined) : componentOf(field.settings.component);
  const kept = Array.isArray(stored) ? stored.slice(0, CARRY_MAX_ITEMS) : [];
  const side = (items: readonly unknown[]) => ({
    keys: items.map((item) => keyOf(walk.view, componentOfItem(item), item)),
    kinds: items.map((item) => componentOfItem(item)?.id ?? null),
  });
  const policy = listPolicyOf(walk, field, unreadable);
  const { pairs, issues } = pairList(
    { sentIds: written.map(sentIdOf), sent: side(written), storedIds: kept.map(idOf), stored: side(kept) },
    policy,
    walk.budget,
  );
  walk.issues.push(...issues.map((issue) => itemIssueOf(issue, path, { unseen: policy.unseen })));
  return {
    pairs,
    inside: written.map((item, index) => {
      const pair = pairs[index] ?? -1;
      return pairInstance(
        walk,
        componentOfItem(item),
        item,
        pair === -1 ? undefined : kept[pair],
        pointer(path, index),
      );
    }),
  };
};

const pairFields = (
  walk: Walk,
  fields: readonly FieldDefinition[],
  written: unknown,
  stored: unknown,
  path: string,
  topLevel = false,
): FieldPairings => {
  if (!isRecord(written)) {
    return NO_PAIRINGS;
  }
  const pairings = new Map<string, Pairing>();
  for (const field of fields) {
    if ((field.type === 'component' || field.type === 'dynamiczone') && field.id in written) {
      const pairing = pairValue(
        walk,
        field,
        written[field.id],
        isRecord(stored) ? stored[field.id] : undefined,
        pointer(path, field.apiKey),
        topLevel && walk.view.topLevelReadable !== undefined && !walk.view.topLevelReadable(field),
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
  view: ItemView,
): ItemPairingResult => {
  const walk: Walk = { view, issues: [], hiddenByField: new Map(), budget: newAlignmentBudget() };
  const pairings = pairFields(walk, fields, patch, base, '', true);
  return { pairings, issues: walk.issues };
};
