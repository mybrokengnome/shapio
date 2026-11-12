import type { ComponentDefinition, DefinitionLens, FieldDefinition } from '@shapio/schema';
import { ITEM_ID_KEY } from '../../constants/itemIds.js';
import { matchesFieldType } from '../compiler/select.js';
import type { ComponentLookup } from '../itemIds.js';
import { COMPONENT_KEY, isMissingValue } from '../validator/index.js';
import { itemKey } from './listPairing.js';

/**
 * Everything a write needs to know about what one caller sees of an entry's component items (plan item-ids),
 * answered in one place for the write without a version, the write through a schema version, and the carry-over:
 *
 * (a) whether the caller can see the stored items at a position: it may read the entry (grant and row filter),
 *     the head written (draft access, or the draft is the published revision), and every field above the
 *     position (a top-level field, and each component field down to it, single components included);
 * (b) an item's key: what a read returns to this caller for it (fields it reads, the version's fields only,
 *     values the read cuts down cut the same way: relation and media targets it cannot see, values that no
 *     longer fit their field), nested lists item by item;
 * (c) whether a list can hold anything outside that view, from the schema and the caller's capabilities only,
 *     never from values: a field it cannot read (private or deprecated; or, where it cannot see the items, cannot
 *     write), or a field its version does not know or cannot write. Relation targets and media a read leaves out
 *     do not make a list hidden (owner decision, 2026-11-11): they stay behind an item that continues (sent with
 *     its ID, or exactly as read), and go with an item edited without IDs, as before item IDs.
 *
 * Values are compared in storage form (field IDs); a write through a schema version compares in its client's
 * shape (content/lens/write.ts) but asks every question here, passing its version's field set.
 */

/** What one caller may do with an entry's fields today: every view decision is made from these alone. */
export type CallerAccess = {
  /** May read the entry at all: its read grant and row filter (admin: true). */
  mayRead: boolean;
  /** May have read the head the write lands on: draft access, or the draft is the published revision. */
  seesStored: boolean;
  /** Reads a top-level field today (its read mask; deprecated fields never). */
  readsField: (field: FieldDefinition) => boolean;
  /** Reads a field inside a component today (its audience; deprecated fields never). */
  readsComponentField: (field: FieldDefinition) => boolean;
  /** May write a field inside a component (its audience can read it; deprecated fields never). */
  writesComponentField: (field: FieldDefinition) => boolean;
  /** Relation targets a read shows; null: every target (admin). */
  visibleTargets: ReadonlySet<string> | null;
  /** Media a read shows; null: every asset (admin, which keeps unresolved IDs). */
  visibleMedia: ReadonlySet<string> | null;
  /** A list is never refused (admin): items are paired only when that is certain, the rest are new. */
  neverRefuses: boolean;
  /**
   * May read every head on its route, drafts included (admin-kind delivery callers): no item it names from a head
   * it read is unseen, so `shownElsewhere` (listPairing.ts) never refuses it.
   */
  readsDrafts?: boolean;
  /**
   * The write adds a locale (no draft in it yet): its localized fields store nothing, so lists there are new items
   * whatever the caller may read. Shared fields hold the other locales' values and keep the usual rule.
   */
  newLocale?: boolean;
};

/** The fields a client knows: today's (no version), or a schema version's, by today's stable field IDs. */
export type FieldSet = {
  /** The client's version has this (today's) field. */
  knows: (field: FieldDefinition) => boolean;
  /** The client writes it as stored (same type and localization; through a version, unchanged since). */
  writesShape: (field: FieldDefinition) => boolean;
};

export const TODAY_FIELDS: FieldSet = { knows: () => true, writesShape: () => true };

/**
 * A schema version's field set, by today's stable IDs, for the fields inside components (top-level fields are
 * the translation's): fields added since are unknown to it, fields changed since (another type or localization,
 * or a component it cannot write) it cannot write.
 */
export const lensFieldSet = (lens: DefinitionLens | null | undefined): FieldSet => {
  if (!lens) {
    return TODAY_FIELDS;
  }
  const added = new Set<string>();
  const unwritable = new Set<string>();
  const seen = new Set<string>();
  const walk = (current: DefinitionLens, nested: boolean) => {
    if (seen.has(current.definitionId)) {
      return;
    }
    seen.add(current.definitionId);
    if (nested) {
      current.addedFieldIds.forEach((id) => added.add(id));
    }
    for (const field of current.fields) {
      const writable = field.kind === 'same' && field.client.localized === field.stored.localized;
      if (nested && !writable) {
        unwritable.add(field.fieldId);
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
  walk(lens, false);
  return { knows: (field) => !added.has(field.id), writesShape: (field) => !unwritable.has(field.id) };
};

/** Admin access: reads and writes every field that is not deprecated, sees every target, never refused. */
export const ADMIN_ACCESS: CallerAccess = {
  mayRead: true,
  seesStored: true,
  readsField: (field) => !field.deprecated,
  readsComponentField: (field) => !field.deprecated,
  writesComponentField: (field) => !field.deprecated,
  visibleTargets: null,
  visibleMedia: null,
  neverRefuses: true,
  readsDrafts: true,
};

/** Where in the entry a value sits, for the caller: whether it may read there, and see the stored items. */
export type ViewScope = {
  /** The caller reads this position: it may read the entry and every field above it. */
  reads: boolean;
  /** It may also have read the stored items here: `reads`, and it may have read the head written. */
  sees: boolean;
  /** Nothing is stored here or below (a new item, a localized field of a new locale): there is nothing to see. */
  fresh?: boolean;
};

export type CallerView = {
  readonly access: CallerAccess;
  readonly componentOf: ComponentLookup;
  /** The scope of the entry's top level. */
  readonly top: ViewScope;
  /** The scope inside a field at `scope` (a top-level field when `topLevel`). */
  inside: (scope: ViewScope, field: FieldDefinition, topLevel: boolean) => ViewScope;
  /**
   * The scope inside an item: as `scope` when it continues a stored item; for a new item (nothing stored under it)
   * the caller knows everything stored there, which is nothing, so its lists are new items.
   */
  within: (scope: ViewScope, continues: boolean) => ViewScope;
  /** Whether a read at `scope` shows this component field (at any depth). */
  shows: (scope: ViewScope, field: FieldDefinition) => boolean;
  /** A component field the write keeps from the stored item when the caller leaves it out. */
  carried: (scope: ViewScope, field: FieldDefinition) => boolean;
  /** (c) Items of this list field can hold a value outside the caller's view where it is written. */
  holdsHidden: (scope: ViewScope, field: FieldDefinition) => boolean;
  /** (b) The key of a stored item: what a read at `scope` returns of it. Null when it holds no component. */
  storedKey: (scope: ViewScope, component: ComponentDefinition | undefined, item: unknown) => string | null;
  /**
   * The key of a whole item, stored or sent (storage form, IDs left out, nothing cut): only for a list the caller
   * writes in full where it cannot see the items, whose items it may send back exactly as stored.
   */
  wholeKey: (component: ComponentDefinition | undefined, item: unknown) => string | null;
  /** (b) The key of a sent item (storage form): what it says about what that read returns. */
  sentKey: (scope: ViewScope, component: ComponentDefinition | undefined, item: unknown) => string | null;
  /** A stored value as a read at `scope` returns it (storage form): targets and misfits left out. */
  shownValue: (scope: ViewScope, field: FieldDefinition, value: unknown) => unknown;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isComponentField = (field: FieldDefinition) =>
  field.type === 'component' || field.type === 'dynamiczone';

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

/** The component a stored or sent item of this field holds (zone items name theirs). */
export const componentOfItem = (
  field: FieldDefinition,
  item: unknown,
  componentOf: ComponentLookup,
): ComponentDefinition | undefined => {
  if (field.type === 'component') {
    return componentOf(field.settings.component);
  }
  if (field.type !== 'dynamiczone' || !isRecord(item) || typeof item[COMPONENT_KEY] !== 'string') {
    return undefined;
  }
  const component = componentOf(item[COMPONENT_KEY]);
  return component && field.settings.components.includes(component.id) ? component : undefined;
};

/** Target IDs a read shows: relation targets and media it can see (null: all). */
const cutTargets = (value: unknown, visible: ReadonlySet<string> | null, many: boolean): unknown => {
  if (visible === null) {
    return value;
  }
  if (many) {
    const shown = (Array.isArray(value) ? value : [value]).filter(
      (id): id is string => typeof id === 'string' && visible.has(id),
    );
    return shown.length > 0 ? shown : undefined;
  }
  return typeof value === 'string' && visible.has(value) ? value : undefined;
};

/**
 * The one view of a caller over an entry's component items. `fields` is today's (no version) or the client's
 * version's field set, by today's stable IDs.
 */
export const callerViewOf = (
  access: CallerAccess,
  componentOf: ComponentLookup,
  fields: FieldSet = TODAY_FIELDS,
): CallerView => {
  const reads = (field: FieldDefinition) => access.readsComponentField(field) && fields.knows(field);
  const writes = (field: FieldDefinition) =>
    access.writesComponentField(field) && fields.knows(field) && fields.writesShape(field);
  const shows = (scope: ViewScope, field: FieldDefinition) => scope.reads && reads(field);
  const hiddenMemo = new Map<string, boolean>();

  const holdsHidden = (scope: ViewScope, field: FieldDefinition): boolean => {
    const memoKey = `${scope.sees ? 's' : 'u'}${field.id}`;
    const known = hiddenMemo.get(memoKey);
    if (known !== undefined) {
      return known;
    }
    const visited = new Set<string>();
    const hides = (components: readonly ComponentDefinition[]): boolean =>
      components.some((component) => {
        if (visited.has(component.id)) {
          return false;
        }
        visited.add(component.id);
        return component.fields.some(
          (nested) =>
            !writes(nested) ||
            (scope.sees && !reads(nested)) ||
            hides(componentsOfField(nested, componentOf)),
        );
      });
    const result = hides(componentsOfField(field, componentOf));
    hiddenMemo.set(memoKey, result);
    return result;
  };

  const shownValue = (scope: ViewScope, field: FieldDefinition, value: unknown): unknown => {
    if (isMissingValue(value) || !matchesFieldType(field, value)) {
      return undefined;
    }
    switch (field.type) {
      case 'relation':
        return cutTargets(value, access.visibleTargets, field.settings.cardinality === 'many');
      case 'media':
        return cutTargets(value, access.visibleMedia, Boolean(field.settings.multiple));
      case 'component':
      case 'dynamiczone': {
        const one = (item: unknown) => {
          const component = componentOfItem(field, item, componentOf);
          return component && isRecord(item) ? shownItem(scope, component, item) : undefined;
        };
        if (field.type === 'component' && !field.settings.repeatable) {
          return one(value);
        }
        const items = (value as unknown[]).flatMap((item) => {
          const shown = one(item);
          return shown === undefined ? [] : [shown];
        });
        return items.length > 0 ? items : undefined;
      }
      default:
        return value;
    }
  };

  /** A stored item as a read shows it, storage form, with its component and ID (a nested key needs neither). */
  const shownItem = (
    scope: ViewScope,
    component: ComponentDefinition,
    item: Readonly<Record<string, unknown>>,
  ): Record<string, unknown> => {
    const output: Record<string, unknown> = { [COMPONENT_KEY]: component.id };
    for (const field of component.fields) {
      if (!shows(scope, field)) {
        continue;
      }
      const shown = shownValue(scope, field, item[field.id]);
      if (shown !== undefined) {
        output[field.id] = shown;
      }
    }
    return output;
  };

  /** A sent item restricted to what that read would show: the same fields, its own values (never cut). */
  const sentItem = (
    scope: ViewScope,
    component: ComponentDefinition,
    item: Readonly<Record<string, unknown>>,
  ): Record<string, unknown> => {
    const output: Record<string, unknown> = { [COMPONENT_KEY]: component.id };
    for (const field of component.fields) {
      const value = item[field.id];
      if (!shows(scope, field) || isMissingValue(value)) {
        continue;
      }
      if (!isComponentField(field)) {
        output[field.id] = value;
        continue;
      }
      const one = (nested: unknown) => {
        const nestedComponent = componentOfItem(field, nested, componentOf);
        return nestedComponent && isRecord(nested) ? sentItem(scope, nestedComponent, nested) : nested;
      };
      output[field.id] =
        field.type === 'component' && !field.settings.repeatable
          ? one(value)
          : Array.isArray(value)
            ? value.map(one)
            : value;
    }
    return output;
  };

  /** A scope for `shownValue` on a relation or media value alone (it only cuts targets there). */
  const TARGETS_ONLY: ViewScope = { reads: true, sees: true };

  /** An item without its IDs and empty values, at any depth through its components. */
  const wholeItem = (
    component: ComponentDefinition,
    item: Readonly<Record<string, unknown>>,
  ): Record<string, unknown> => {
    const output: Record<string, unknown> = { [COMPONENT_KEY]: component.id };
    for (const field of component.fields) {
      const value = item[field.id];
      if (isMissingValue(value)) {
        continue;
      }
      if (!isComponentField(field)) {
        // Relation targets and media the caller's read leaves out are cut, so no key depends on them.
        const kept =
          field.type === 'relation' || field.type === 'media'
            ? shownValue(TARGETS_ONLY, field, value)
            : value;
        if (kept !== undefined) {
          output[field.id] = kept;
        }
        continue;
      }
      const one = (nested: unknown) => {
        const nestedComponent = componentOfItem(field, nested, componentOf);
        return nestedComponent && isRecord(nested) ? wholeItem(nestedComponent, nested) : nested;
      };
      output[field.id] =
        field.type === 'component' && !field.settings.repeatable
          ? one(value)
          : Array.isArray(value)
            ? value.map(one)
            : value;
    }
    return output;
  };

  return {
    access,
    componentOf,
    top: { reads: access.mayRead, sees: access.mayRead && access.seesStored },
    inside: (scope, field, topLevel) => {
      const readsHere =
        scope.reads && (topLevel ? access.readsField(field) && fields.knows(field) : reads(field));
      const fresh = scope.fresh === true || (topLevel && access.newLocale === true && field.localized);
      return { reads: readsHere, sees: (readsHere && scope.sees) || fresh, fresh };
    },
    within: (scope, continues) => (continues ? scope : { ...scope, sees: true, fresh: true }),
    shows,
    carried: (scope, field) => (scope.reads ? !reads(field) : !writes(field)) || !writes(field),
    holdsHidden,
    storedKey: (scope, component, item) =>
      component && isRecord(item) ? itemKey(shownItem(scope, component, item)) : null,
    wholeKey: (component, item) => (component && isRecord(item) ? itemKey(wholeItem(component, item)) : null),
    sentKey: (scope, component, item) =>
      component && isRecord(item) ? itemKey(sentItem(scope, component, item)) : null,
    shownValue,
  };
};

/** Whether a stored item holds this ID (every stored item does once read: `withItemIds`). */
export const storedItemId = (item: unknown): string | null =>
  isRecord(item) && typeof item[ITEM_ID_KEY] === 'string' && item[ITEM_ID_KEY] !== ''
    ? item[ITEM_ID_KEY]
    : null;
