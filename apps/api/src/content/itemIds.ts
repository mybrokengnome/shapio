import { createHmac, randomUUID } from 'node:crypto';
import type { ComponentDefinition, FieldDefinition } from '@shapio/schema';
import { ITEM_ID_FIELD, ITEM_ID_KEY } from '../constants/itemIds.js';
import type { ContentData } from '../db/contentData.js';
import * as schemaVersionsRepository from '../repositories/schemaVersions.js';
import { COMPONENT_KEY } from './validator/index.js';
import { compactCanonical } from './write/listPairing.js';

/**
 * Item IDs (plan item-ids): every component instance (a single component, an item of a repeatable component
 * or of a dynamic zone, at any depth) has an ID. It is stored under `__id`, beside `__component`, and every API
 * shows it as `id`. A write continues an item by the ID it sends; an item without one is new and gets a random
 * ID. Items stored before item IDs existed have none: reads derive one from the stored item (`withItemIds`), a
 * keyed hash over the entry, the item's place, and its whole stored content, so an unchanged item has the same
 * ID in the draft and the published version, in every locale (shared fields), at any position, and after a
 * restore. The key is the instance's secret (`system_versions.item_id_key`): an ID never lets a caller test a
 * guess of a value it cannot read. A write persists the IDs of the lists it writes.
 */

/** The storage key of an item's ID (`__id`) and the key every API shows it under (`id`). */
export { ITEM_ID_FIELD, ITEM_ID_KEY };

export type ComponentLookup = (componentId: string) => ComponentDefinition | undefined;

type KeyExecutor = Parameters<typeof schemaVersionsRepository.getItemIdKey>[0];

const keys = new WeakMap<object, Promise<Buffer>>();

/**
 * What the key is cached by: the database, whichever handle reads it. A transaction shares its database's
 * dialect adapter, so a read inside one finds the key its database already read.
 */
const cacheIdentityOf = (executor: NonNullable<KeyExecutor>): object => {
  const adapter = (executor as { getExecutor?: () => { adapter?: unknown } }).getExecutor?.().adapter;
  return typeof adapter === 'object' && adapter !== null ? adapter : executor;
};

/** The instance's item ID key, read once per database. */
export const itemIdKeyOf = (executor: NonNullable<KeyExecutor>): Promise<Buffer> => {
  const identity = cacheIdentityOf(executor);
  let key = keys.get(identity);
  if (!key) {
    key = schemaVersionsRepository.getItemIdKey(executor).then((hex) => Buffer.from(hex, 'hex'));
    keys.set(identity, key);
    key.catch(() => keys.delete(identity));
  }
  return key;
};

/** A fresh ID for a new item. */
export const newItemId = (): string => randomUUID();

/** Bytes in UUID form (version 8, the custom layout), so derived IDs look like the random ones. */
const uuidOf = (bytes: Buffer): string => {
  const b = Buffer.from(bytes.subarray(0, 16));
  b[6] = ((b[6] as number) & 0x0f) | 0x80;
  b[8] = ((b[8] as number) & 0x3f) | 0x80;
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

/** Where items are derived for: the entry, under the instance key. */
export type ItemIdScope = { key: Buffer; entryId: string };

const derive = (scope: ItemIdScope, path: readonly string[], content: string, occurrence: number) =>
  uuidOf(
    createHmac('sha256', scope.key)
      .update(JSON.stringify([scope.entryId, path, content, occurrence]))
      .digest(),
  );

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const storedId = (item: Readonly<Record<string, unknown>>): string | undefined => {
  const id = item[ITEM_ID_KEY];
  return typeof id === 'string' && id !== '' ? id : undefined;
};

const componentOfItem = (
  field: FieldDefinition,
  componentOf: ComponentLookup,
  item: unknown,
): ComponentDefinition | undefined =>
  field.type === 'component'
    ? componentOf(field.settings.component)
    : isRecord(item) && typeof item[COMPONENT_KEY] === 'string'
      ? componentOf(item[COMPONENT_KEY])
      : undefined;

/** One instance with its ID, and the instances inside it, under `path` (its place, its parent's ID included). */
const instanceWithIds = (
  scope: ItemIdScope,
  component: ComponentDefinition | undefined,
  item: Readonly<Record<string, unknown>>,
  id: string,
  componentOf: ComponentLookup,
): Record<string, unknown> => ({
  ...(component ? fieldsWithIds(scope, component.fields, item, [id], componentOf) : item),
  [ITEM_ID_KEY]: id,
});

const valueWithIds = (
  scope: ItemIdScope,
  field: FieldDefinition,
  value: unknown,
  path: readonly string[],
  componentOf: ComponentLookup,
): unknown => {
  if (field.type === 'component' && !field.settings.repeatable) {
    if (!isRecord(value)) {
      return value;
    }
    const id = storedId(value) ?? derive(scope, path, 'single', 0);
    return instanceWithIds(scope, componentOf(field.settings.component), value, id, componentOf);
  }
  if (!Array.isArray(value)) {
    return value;
  }
  const seen = new Map<string, number>();
  return value.map((item: unknown) => {
    if (!isRecord(item)) {
      return item;
    }
    let id = storedId(item);
    if (!id) {
      const content = compactCanonical(item);
      const occurrence = seen.get(content) ?? 0;
      seen.set(content, occurrence + 1);
      id = derive(scope, path, content, occurrence);
    }
    return instanceWithIds(scope, componentOfItem(field, componentOf, item), item, id, componentOf);
  });
};

function fieldsWithIds(
  scope: ItemIdScope,
  fields: readonly FieldDefinition[],
  data: Readonly<Record<string, unknown>>,
  parent: readonly string[],
  componentOf: ComponentLookup,
): Record<string, unknown> {
  const output: Record<string, unknown> = { ...data };
  for (const field of fields) {
    if ((field.type === 'component' || field.type === 'dynamiczone') && data[field.id] !== undefined) {
      output[field.id] = valueWithIds(scope, field, data[field.id], [...parent, field.id], componentOf);
    }
  }
  return output;
}

/**
 * `data` (storage form) with an ID on every component instance, at any depth: the stored one, or for an
 * instance stored without one, the ID derived from it. Deterministic: the same stored data always reads with
 * the same IDs.
 */
export const withItemIds = (
  data: Readonly<ContentData>,
  fields: readonly FieldDefinition[],
  componentOf: ComponentLookup,
  scope: ItemIdScope,
): ContentData => fieldsWithIds(scope, fields, data, [], componentOf);

/**
 * `data` (storage form) with an ID on every component instance, at any depth: one without gets a fresh ID.
 * With `renew`, every instance gets a new ID instead, the same new ID wherever the same old ID appears (a copy
 * of an entry, its locales sharing items; a new entry, whose IDs are the server's, never the caller's).
 */
export const assignItemIds = (
  data: Readonly<ContentData>,
  fields: readonly FieldDefinition[],
  componentOf: ComponentLookup,
  { renew }: { renew?: Map<string, string> } = {},
): ContentData => {
  const idFor = (item: Readonly<Record<string, unknown>>): string => {
    const old = storedId(item);
    if (!renew) {
      return old ?? newItemId();
    }
    if (old === undefined) {
      return newItemId();
    }
    const known = renew.get(old);
    if (known) {
      return known;
    }
    const fresh = newItemId();
    renew.set(old, fresh);
    return fresh;
  };
  const instance = (component: ComponentDefinition | undefined, item: unknown): unknown =>
    isRecord(item)
      ? { ...(component ? walk(component.fields, item) : item), [ITEM_ID_KEY]: idFor(item) }
      : item;
  const walk = (
    current: readonly FieldDefinition[],
    value: Readonly<Record<string, unknown>>,
  ): Record<string, unknown> => {
    const output: Record<string, unknown> = { ...value };
    for (const field of current) {
      const held = value[field.id];
      if (field.type === 'component' && !field.settings.repeatable) {
        output[field.id] = held === undefined ? held : instance(componentOf(field.settings.component), held);
      } else if ((field.type === 'component' || field.type === 'dynamiczone') && Array.isArray(held)) {
        output[field.id] = held.map((item: unknown) =>
          instance(componentOfItem(field, componentOf, item), item),
        );
      }
    }
    return output;
  };
  return walk(fields, data);
};

/**
 * `to` (data a schema conversion produced from `from`) with the IDs `from`'s instances read with (`from` with
 * its IDs: `withItemIds`), instance by instance at the same place: a conversion persists the IDs of the items
 * it rewrites, so a client holding them can still send them back (plan item-ids). A list made single keeps its
 * first item's ID, a single instance made a list keeps its own; a zone item keeps its ID only while it holds the
 * same component. Instances still without an ID get a new one.
 */
export const transferItemIds = (
  from: Readonly<ContentData>,
  to: Readonly<ContentData>,
  fields: readonly FieldDefinition[],
  componentOf: ComponentLookup,
): ContentData => {
  const asList = (value: unknown): unknown[] =>
    Array.isArray(value) ? value : value === undefined ? [] : [value];
  const instance = (component: ComponentDefinition | undefined, item: unknown, source: unknown): unknown => {
    if (!isRecord(item)) {
      return item;
    }
    const sameKind = !isRecord(source) || source[COMPONENT_KEY] === item[COMPONENT_KEY];
    const id = storedId(item) ?? (isRecord(source) && sameKind ? storedId(source) : undefined) ?? newItemId();
    return {
      ...(component ? walk(component.fields, item, isRecord(source) && sameKind ? source : {}) : item),
      [ITEM_ID_KEY]: id,
    };
  };
  const walk = (
    current: readonly FieldDefinition[],
    value: Readonly<Record<string, unknown>>,
    source: Readonly<Record<string, unknown>>,
  ): Record<string, unknown> => {
    const output: Record<string, unknown> = { ...value };
    for (const field of current) {
      const held = value[field.id];
      const before = asList(source[field.id]);
      if (field.type === 'component' && !field.settings.repeatable) {
        output[field.id] =
          held === undefined ? held : instance(componentOf(field.settings.component), held, before[0]);
      } else if ((field.type === 'component' || field.type === 'dynamiczone') && Array.isArray(held)) {
        output[field.id] = held.map((item: unknown, index) =>
          instance(componentOfItem(field, componentOf, item), item, before[index]),
        );
      }
    }
    return output;
  };
  return walk(fields, to, from);
};

/** The components of a content model by ID, as the walkers above look them up. */
export const componentLookupOf =
  (components: ReadonlyMap<string, { definition: ComponentDefinition }>): ComponentLookup =>
  (componentId) =>
    components.get(componentId)?.definition;
