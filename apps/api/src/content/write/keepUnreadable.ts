import {
  canonicalJson,
  type ComponentDefinition,
  type DefinitionLens,
  type FieldDefinition,
} from '@shapio/schema';
import type { ContentData } from '../../db/contentData.js';
import { COMPONENT_KEY, isMissingValue } from '../validator/index.js';

/**
 * A component instance is written whole, so a delivery caller that cannot read one of its fields (private to
 * its audience, or deprecated), or through a schema lens does not know it (added since its version) or cannot
 * write it (changed since), would wipe that field's stored value just by sending back what it read. Such fields
 * are carried over from the stored instance instead, in storage form (never through today's input validator):
 *
 * - A single component: carried over from the stored instance.
 * - Repeatable components and dynamic zones: each item sent is matched to a stored item first by what the caller
 *   sees of it (the fields it may read, deep-equal; the same component for zone items; stored items taken in
 *   order for duplicates), which follows deletes, inserts and reorders of untouched items exactly. An item left
 *   over is matched to the stored item at its position only when the list kept its length, that stored item
 *   was not matched elsewhere, and (zones) it holds the same component: an edit in place. Any other item is new
 *   and carries nothing (its hidden fields take their defaults); stored items left over are deleted with what
 *   they held.
 * - A caller that may not read the entry compares by what it may write, and a sub-field it sends as an explicit
 *   null is cleared; one it leaves out is kept.
 *
 * Admin writes never need it (admins read everything).
 */
export type ComponentLookup = (componentId: string) => ComponentDefinition | undefined;

export type KeepOptions = {
  /** The caller may read the entry (default true). Without, comparisons use what it may write. */
  mayRead?: boolean;
  /** The body the patch was made from (today's API IDs): tells an explicit null from a field left out. */
  input?: Readonly<Record<string, unknown>>;
  /** Through a schema lens: fields the client's version does not know or cannot write are carried too. */
  lens?: DefinitionLens | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const at = (value: unknown, index: number): unknown => (Array.isArray(value) ? value[index] : undefined);

/** Component fields, at any depth, a lens says the client does not know or cannot write: carried, never sent. */
const lensCarriedIds = (lens: DefinitionLens | null | undefined): Set<string> => {
  const ids = new Set<string>();
  const seen = new Set<string>();
  const walk = (current: DefinitionLens, nested: boolean) => {
    if (seen.has(current.definitionId)) {
      return;
    }
    seen.add(current.definitionId);
    if (nested) {
      current.addedFieldIds.forEach((id) => ids.add(id));
    }
    for (const field of current.fields) {
      const writable = field.kind === 'same' && field.client.localized === field.stored.localized;
      if (nested && !writable) {
        ids.add(field.fieldId);
      }
      if (field.kind !== 'null') {
        for (const component of field.nested?.components.values() ?? []) {
          if (component) {
            walk(component, true);
          }
        }
      }
    }
  };
  if (lens) {
    walk(lens, false);
  }
  return ids;
};

type Rules = {
  componentOf: ComponentLookup;
  /** Carried from storage when the caller leaves it out. */
  carried: (field: FieldDefinition) => boolean;
  /** What the caller sees of an item, to match sent items with stored ones. */
  compared: (field: FieldDefinition) => boolean;
  /** An explicit null clears (a caller that read nothing cannot have read the value it would keep). */
  nullClears: boolean;
};

/** What the caller sees of an instance (storage form), at any depth: the key items are matched by. */
const seenOf = (rules: Rules, component: ComponentDefinition | undefined, item: unknown): unknown => {
  if (!component || !isRecord(item)) {
    return item;
  }
  const output: Record<string, unknown> = {};
  for (const field of component.fields) {
    const value = item[field.id];
    if (rules.compared(field) && !isMissingValue(value)) {
      output[field.id] = seenValue(rules, field, value);
    }
  }
  return output;
};

const seenValue = (rules: Rules, field: FieldDefinition, value: unknown): unknown => {
  if (field.type === 'component') {
    const component = rules.componentOf(field.settings.component);
    return Array.isArray(value)
      ? value.map((item) => seenOf(rules, component, item))
      : seenOf(rules, component, value);
  }
  if (field.type === 'dynamiczone' && Array.isArray(value)) {
    return value.map((item: unknown) =>
      isRecord(item) && typeof item[COMPONENT_KEY] === 'string'
        ? {
            ...(seenOf(rules, rules.componentOf(item[COMPONENT_KEY]), item) as object),
            [COMPONENT_KEY]: item[COMPONENT_KEY],
          }
        : item,
    );
  }
  return value;
};

/** One instance written over its matched stored instance (or none: a new item, nothing carried). */
const keepInInstance = (
  rules: Rules,
  component: ComponentDefinition | undefined,
  written: unknown,
  stored: unknown,
  raw: unknown,
): unknown => {
  if (!component || !isRecord(written)) {
    return written;
  }
  const output: Record<string, unknown> = { ...written };
  const sent = isRecord(raw) ? raw : {};
  for (const field of component.fields) {
    const storedValue = isRecord(stored) ? stored[field.id] : undefined;
    const explicitNull = Object.hasOwn(sent, field.apiKey) && isMissingValue(sent[field.apiKey]);
    if (rules.carried(field) && isMissingValue(output[field.id])) {
      if (!isMissingValue(storedValue) && !(rules.nullClears && explicitNull)) {
        output[field.id] = storedValue;
      }
    } else if (field.id in output) {
      output[field.id] = keepInValue(rules, field, output[field.id], storedValue, sent[field.apiKey]);
    }
  }
  return output;
};

/** Pairs each sent item with the stored item it continues (index into `stored`), or -1 for a new item. */
const matchItems = (
  rules: Rules,
  written: readonly unknown[],
  stored: readonly unknown[],
  componentOfItem: (item: unknown) => ComponentDefinition | undefined,
  sameKind: (sent: unknown, kept: unknown) => boolean,
): number[] => {
  const keyOf = (item: unknown) =>
    canonicalJson({
      kind: isRecord(item) ? (item[COMPONENT_KEY] ?? null) : null,
      seen: seenOf(rules, componentOfItem(item), item),
    });
  const storedKeys = stored.map(keyOf);
  const taken = new Set<number>();
  const pairs = written.map((item) => {
    const key = keyOf(item);
    const index = storedKeys.findIndex((candidate, position) => !taken.has(position) && candidate === key);
    if (index !== -1) {
      taken.add(index);
    }
    return index;
  });
  if (written.length === stored.length) {
    pairs.forEach((pair, position) => {
      if (pair === -1 && !taken.has(position) && sameKind(written[position], stored[position])) {
        pairs[position] = position;
        taken.add(position);
      }
    });
  }
  return pairs;
};

const keepInValue = (
  rules: Rules,
  field: FieldDefinition,
  written: unknown,
  stored: unknown,
  raw: unknown,
): unknown => {
  if (field.type === 'component') {
    const component = rules.componentOf(field.settings.component);
    if (!Array.isArray(written)) {
      return keepInInstance(rules, component, written, stored, raw);
    }
    const kept = Array.isArray(stored) ? stored : [];
    const pairs = matchItems(
      rules,
      written,
      kept,
      () => component,
      () => true,
    );
    return written.map((item, index) => {
      const pair = pairs[index] ?? -1;
      return keepInInstance(rules, component, item, pair === -1 ? undefined : kept[pair], at(raw, index));
    });
  }
  if (field.type === 'dynamiczone' && Array.isArray(written)) {
    const kept = Array.isArray(stored) ? stored : [];
    const componentOfItem = (item: unknown) =>
      isRecord(item) && typeof item[COMPONENT_KEY] === 'string'
        ? rules.componentOf(item[COMPONENT_KEY])
        : undefined;
    const pairs = matchItems(
      rules,
      written,
      kept,
      componentOfItem,
      (sent, old) => isRecord(sent) && isRecord(old) && sent[COMPONENT_KEY] === old[COMPONENT_KEY],
    );
    return written.map((item: unknown, index) => {
      const pair = pairs[index] ?? -1;
      return keepInInstance(
        rules,
        componentOfItem(item),
        item,
        pair === -1 ? undefined : kept[pair],
        at(raw, index),
      );
    });
  }
  return written;
};

/**
 * `patch` (field IDs, storage form) with every component field the caller cannot read (or, through a lens,
 * does not know or cannot write) carried over from `before` (the draft the write starts from), at any depth,
 * items matched as described above. Top-level fields are untouched: a patch only changes the fields it names.
 */
export const keepUnreadableComponentFields = (
  patch: Readonly<ContentData>,
  before: Readonly<ContentData>,
  fields: readonly FieldDefinition[],
  componentOf: ComponentLookup,
  readable: (field: FieldDefinition) => boolean,
  options: KeepOptions = {},
): ContentData => {
  const mayRead = options.mayRead ?? true;
  const lensIds = lensCarriedIds(options.lens);
  const rules: Rules = {
    componentOf,
    carried: (field) => !readable(field) || lensIds.has(field.id),
    // What the caller sees: what it may read; without read access, what it may write (deprecated fields
    // cannot be written); never what its version does not know or cannot write.
    compared: (field) => (mayRead ? readable(field) : !field.deprecated) && !lensIds.has(field.id),
    nullClears: !mayRead,
  };
  const input = options.input ?? {};
  const output: ContentData = { ...patch };
  for (const field of fields) {
    if (field.id in output && (field.type === 'component' || field.type === 'dynamiczone')) {
      output[field.id] = keepInValue(rules, field, output[field.id], before[field.id], input[field.apiKey]);
    }
  }
  return output;
};
