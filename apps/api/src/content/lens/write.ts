import {
  canonicalJson,
  isComponentDefinition,
  type ComponentDefinition,
  type DefinitionLens,
  type FieldDefinition,
  type FieldLens,
  type SchemaDefinition,
} from '@shapio/schema';
import { ITEM_ID_FIELD, ITEM_ID_KEY } from '../../constants/itemIds.js';
import type { ContentData } from '../../db/contentData.js';
import { matchesFieldType } from '../compiler/select.js';
import { COMPONENT_KEY, isMissingValue } from '../validator/index.js';
import { pointer, type ContentIssue } from '../validator/issues.js';
import {
  callerViewOf,
  lensFieldSet,
  type CallerAccess,
  type CallerView,
  type ViewScope,
} from '../write/callerView.js';
import {
  CARRY_MAX_ITEMS,
  itemIssueOf,
  itemKey,
  listCapOf,
  listTooLong,
  pairList,
  pairSingle,
  shownCounterparts,
  shownItemsAt,
  type FieldPairings,
  type Pairing,
} from '../write/listPairing.js';
import { readThroughLens } from './read.js';

/**
 * A write body in the client's schema version (its API IDs) for today's write path (plan schema-lenses,
 * limited writes). Fields that read exactly as stored (`same`, renames allowed) and kept their localization
 * are translated, into components and dynamic-zone items. Any other field is an issue, unless its value equals
 * what the lens reads for the entry today: the client sent back what it read, and the stored value is kept
 * untouched (never the converted value written back). A component instance is written whole, so inside one
 * the fields the client cannot write or does not know keep their stored values: each list item continues the
 * stored item it is paired with, once, by everything the client sees of it (`pairings`; `listPairing.ts`), and
 * what it sent back inside an item is compared with that same stored item. Values are never converted: today's
 * validator checks what is forwarded.
 */
export type LensWriteResult = {
  /** The body in today's API IDs, for the unchanged write path (`fromInput`, validation, storage). */
  input: Record<string, unknown>;
  /** Fields that cannot be written through the lens, by JSON pointer in the client's API IDs. */
  issues: ContentIssue[];
  /**
   * Which stored item each written component item continues, by stored field ID: the only pairing of this
   * write, for the carry-over (`keepUnreadableComponentFields`'s `pairings`).
   */
  pairings: FieldPairings;
  /**
   * Refusals about the items' IDs and pairing (`UNKNOWN_ITEM_ID`, `DUPLICATE_ITEM_ID`, `ITEM_COMPONENT_CHANGED`,
   * `AMBIGUOUS_ITEMS`), as today's `CONTENT_INVALID` issues in the client's API IDs.
   */
  itemIssues: ContentIssue[];
  /**
   * Fields inside components the caller may not write (its audience cannot read them: private, deprecated),
   * sent with a value: JSON pointers in the client's API IDs, for today's `403 FORBIDDEN_FIELD`.
   */
  forbidden: string[];
};

/** What a write through the lens is checked against. */
export type LensWriteBase = {
  /**
   * What the write starts from today, in storage form (field IDs): the draft of the written locale (for a locale
   * with no draft yet, the values it starts with), every component instance with its ID (`withItemIds`); null
   * on create. Component items are paired with its items.
   */
  stored: Readonly<ContentData> | null;
  /**
   * The other heads the caller may read on its route (`shownHeadsOf`), every instance with its ID: IDs they show
   * are never unknown to the caller (`shownElsewhere` in listPairing.ts).
   */
  shown?: ReadonlyArray<Readonly<ContentData>>;
  /**
   * Whether the caller may have read `stored`: it may read drafts, or the draft is the published revision
   * (default true). Without, nothing inside a component is "sent back": a changed field there is refused (it
   * can be left out to keep it).
   */
  seesStored?: boolean;
  /**
   * What the lens reads for the entry today (`readThroughLens`), only what the caller may read
   * (`readableThroughLens`): one per head a client may have read (the draft and the published head of the
   * written locale). A field matching any of them was sent back. Empty on create.
   */
  reads: ReadonlyArray<Readonly<ContentData>>;
  /** Today's effective definition by ID (a model with its inherited fields, a component). */
  definitionOf: (id: string) => SchemaDefinition | undefined;
  /**
   * Whether the caller may read a top-level field today (its read mask) and a component field (at any depth).
   * A field it may not read reads empty through the lens: sent back empty it is left untouched, never cleared,
   * and left out of a component instance it keeps its stored value. Absent: the field's `public` flag decides,
   * the narrowest audience's view. Deprecated fields are never readable.
   */
  readable?: (fieldId: string) => boolean;
  componentFieldReadable?: (fieldId: string) => boolean;
  /**
   * The relation targets the caller may see (published, readable today); a read leaves the others out, so a value
   * sent back is compared with the list without them. Absent or null: every target shows.
   */
  visibleTargets?: ReadonlySet<string> | null;
  /**
   * The caller may read the entry (default true). Without, nothing it sends is "what it read": an explicit
   * null it sends clears a field (the write path's carry-over keeps only what it leaves out).
   */
  mayRead?: boolean;
  /**
   * Whether the caller may write a top-level field today (its write mask). A field it may not write is passed
   * on untranslated under today's API ID, so it gets exactly today's answer (validation, then the forbidden-
   * field refusal), never a lens-specific reason. Absent: every field.
   */
  writable?: (fieldId: string) => boolean;
  /**
   * Whether the caller may write a field inside a component (at any depth): its audience can read it. Absent:
   * every field (admin writes).
   */
  componentFieldWritable?: (fieldId: string) => boolean;
  /**
   * The caller's write grant names no fields (default: true when `writable` is absent). Only then, and only for
   * a field that was public at the client's version, is a field removed since refused with the lens's reason;
   * for anyone else it is a field the version does not have (the unknown-field answer).
   */
  writesEverything?: boolean;
  /**
   * The caller's read grant names no fields (default: it may read the entry, `mayRead`). Only then does a read
   * through the client's version show a component field public at that version and hidden since, as null
   * (`componentFieldShownThroughLens`).
   */
  readsEverything?: boolean;
  /**
   * The caller's view (`callerView.ts`), made with this version's field set: what it sees of the items, their
   * keys, and which lists can hold what it cannot see. Absent: made from the fields above (tests).
   */
  view?: CallerView;
};

/**
 * Whether a read through the client's version shows a component field (at any depth) to the caller, as a value
 * or as null: one it reads today, or, for a caller whose read grant names no fields, one public at that version
 * (hidden since, it reads null). The lensed read and the write's echo rule both ask this, so they cannot drift.
 */
export const componentFieldShownThroughLens = (
  client: FieldDefinition,
  readableToday: boolean,
  readsEverything: boolean,
): boolean => readableToday || (readsEverything && client.public && !client.deprecated);

/** `componentFieldShownThroughLens` for a write's caller: a caller that may not read the entry is shown nothing. */
const shownToWriter = (base: LensWriteBase, field: FieldLens): boolean =>
  base.mayRead !== false &&
  componentFieldShownThroughLens(field.client, readsToday(base, field, true), base.readsEverything ?? true);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const fieldByApiKey = (lens: DefinitionLens, apiKey: string): FieldLens | undefined => {
  const fieldId = lens.apiKeyToFieldId.get(apiKey);
  return fieldId === undefined ? undefined : lens.fields.find((field) => field.fieldId === fieldId);
};

const nestedOf = (field: FieldLens, componentId: string): DefinitionLens | null | undefined =>
  field.kind === 'null' ? undefined : field.nested?.components.get(componentId);

const usable = (lens: DefinitionLens | null | undefined): lens is DefinitionLens =>
  lens !== null && lens !== undefined && (lens.status === 'identity' || lens.status === 'lensed');

/** A field written as the client sends it: stored as read (at most renamed), same localization. */
const isWritable = (field: FieldLens): field is FieldLens & { kind: 'same' } =>
  field.kind === 'same' &&
  field.client.localized === field.stored.localized &&
  (field.client.type !== 'component' || usable(nestedOf(field, field.client.settings.component)));

const DESCRIBED_SETTINGS: ReadonlyArray<[string, string]> = [
  ['multiple', 'switched between one value and a list'],
  ['cardinality', 'switched between one entry and a list'],
  ['repeatable', 'switched between one item and a list'],
  ['target', 'points at another content type'],
  ['values', 'has other allowed values'],
  ['components', 'allows other components'],
  ['formatVersion', 'uses another rich-text format'],
];

/** How a field changed since the client's version, for a refusal. */
const changeOf = (field: FieldLens): string => {
  if (field.kind === 'null') {
    return field.reason === 'removed'
      ? 'was removed'
      : field.reason === 'componentChanged'
        ? 'holds another component now'
        : `changed type (${field.client.type} → ${field.stored?.type ?? 'removed'})`;
  }
  const { client, stored } = field;
  if (client.type !== stored.type) {
    return `changed type (${client.type} → ${stored.type})`;
  }
  if (client.localized !== stored.localized) {
    return stored.localized ? 'became per locale' : 'became shared across locales';
  }
  const from = client.settings as Record<string, unknown>;
  const to = stored.settings as Record<string, unknown>;
  const setting = DESCRIBED_SETTINGS.find(
    ([key]) => canonicalJson(from[key] ?? null) !== canonicalJson(to[key] ?? null),
  );
  return setting ? setting[1] : 'changed';
};

const refusal = (field: FieldLens, path: string): ContentIssue => ({
  path,
  code: 'NOT_ALLOWED',
  message: `${changeOf(field)} since this client's schema version and cannot be written through it; send back the value it read to keep it, or update the client`,
});

/** Inside a component of a draft the caller may not read: nothing can be sent back, only left out. */
const unseenRefusal = (path: string): ContentIssue => ({
  path,
  code: 'NOT_ALLOWED',
  message:
    "cannot be written through this client's schema version while the entry has unpublished changes; leave it out to keep the stored value, or update the client",
});

/** A value the lens read (storage form, field IDs) in the client's input form (API IDs), for comparison. */
const inputFormOf = (lens: DefinitionLens, data: unknown): unknown => {
  if (!isRecord(data)) {
    return data;
  }
  const output: Record<string, unknown> = {};
  for (const field of lens.fields) {
    const value = data[field.fieldId];
    if (!isMissingValue(value)) {
      output[field.apiKey] = fieldInputForm(field, value);
    }
  }
  return output;
};

const fieldInputForm = (field: FieldLens, value: unknown): unknown => {
  if (field.kind === 'null') {
    return value;
  }
  const { client } = field;
  if (client.type === 'component') {
    const lens = nestedOf(field, client.settings.component);
    if (!lens) {
      return value;
    }
    return Array.isArray(value) ? value.map((item) => inputFormOf(lens, item)) : inputFormOf(lens, value);
  }
  if (client.type === 'dynamiczone' && Array.isArray(value)) {
    return value.map((item: unknown): unknown => {
      const lens = isRecord(item) ? nestedOf(field, String(item[COMPONENT_KEY])) : undefined;
      return lens ? { ...(inputFormOf(lens, item) as object), [COMPONENT_KEY]: lens.apiKey } : item;
    });
  }
  return value;
};

/** An ID from a value a delivery read returned for a reference: the ID itself, or a view with an `id`. */
const idOf = (value: unknown): unknown =>
  isRecord(value) && typeof value.id === 'string' ? value.id : value;

/**
 * A value as a client echoes it from a delivery read, in input form: media and populated relations as their
 * IDs (delivery shows asset views and entries), rich text without the rendered `html`, inside components and
 * zone items too.
 */
const echoed = (field: FieldLens, value: unknown): unknown => {
  if (isMissingValue(value) || field.kind === 'null') {
    return value;
  }
  const { client } = field;
  switch (client.type) {
    case 'media':
    case 'relation':
      return Array.isArray(value) ? value.map(idOf) : idOf(value);
    case 'richtext': {
      if (!isRecord(value)) {
        return value;
      }
      const { html: _html, ...document } = value;
      return document;
    }
    case 'component': {
      const lens = nestedOf(field, client.settings.component);
      return lens
        ? Array.isArray(value)
          ? value.map((item) => echoedInstance(lens, item))
          : echoedInstance(lens, value)
        : value;
    }
    case 'dynamiczone':
      return Array.isArray(value)
        ? value.map((item: unknown): unknown => {
            if (!isRecord(item)) {
              return item;
            }
            const lens = [...(field.nested?.components.values() ?? [])].find(
              (candidate) => candidate?.apiKey === item[COMPONENT_KEY],
            );
            return lens
              ? { ...(echoedInstance(lens, item) as object), [COMPONENT_KEY]: item[COMPONENT_KEY] }
              : item;
          })
        : value;
    default:
      return value;
  }
};

const echoedInstance = (lens: DefinitionLens, item: unknown): unknown => {
  if (!isRecord(item)) {
    return item;
  }
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(item)) {
    // An item's `id` says which stored item it is, not what it holds: the read's input form leaves it out too
    // (`inputFormOf`), so a value sent back as read, with the IDs read, matches.
    if (key === COMPONENT_KEY || key === ITEM_ID_FIELD) {
      continue;
    }
    const field = fieldByApiKey(lens, key);
    // A null the read emitted for an empty field is the field left empty.
    if (!isMissingValue(value)) {
      output[key] = field ? echoed(field, value) : value;
    }
  }
  return output;
};

/** Whether `sent` keeps `read`'s order and holds nothing else (relations hide targets a caller may not see). */
/**
 * A lensed read as the caller receives it: relation IDs of targets it may not see left out, at any depth
 * (`visible` null: every target shows).
 */
const visibleRead = (field: FieldLens, value: unknown, visible: ReadonlySet<string> | null): unknown => {
  if (visible === null || field.kind === 'null' || isMissingValue(value)) {
    return value;
  }
  const { client } = field;
  if (client.type === 'relation') {
    return Array.isArray(value)
      ? value.filter((id) => typeof id === 'string' && visible.has(id))
      : typeof value === 'string' && visible.has(value)
        ? value
        : undefined;
  }
  const instance = (lens: DefinitionLens | null | undefined, item: unknown): unknown => {
    if (!lens || !isRecord(item)) {
      return item;
    }
    const output: Record<string, unknown> = { ...item };
    for (const nested of lens.fields) {
      if (nested.fieldId in output) {
        output[nested.fieldId] = visibleRead(nested, output[nested.fieldId], visible);
      }
    }
    return output;
  };
  if (client.type === 'component') {
    const lens = nestedOf(field, client.settings.component);
    return Array.isArray(value) ? value.map((item) => instance(lens, item)) : instance(lens, value);
  }
  if (client.type === 'dynamiczone' && Array.isArray(value)) {
    return value.map((item: unknown) =>
      instance(isRecord(item) ? nestedOf(field, String(item[COMPONENT_KEY])) : undefined, item),
    );
  }
  return value;
};

/**
 * Whether `value` is exactly what the caller reads for the field in one head, order included (absent and empty
 * count as the same): anything else on a field it cannot write is refused, never silently kept.
 */
const matchesRead = (
  field: FieldLens,
  value: unknown,
  stored: unknown,
  visible: ReadonlySet<string> | null,
): boolean => {
  const current = visibleRead(field, stored, visible);
  if (isMissingValue(value) || isMissingValue(current)) {
    return isMissingValue(value) && isMissingValue(current);
  }
  return canonicalJson(echoed(field, value)) === canonicalJson(fieldInputForm(field, current));
};

/** Whether the client sent back exactly what it reads today, from any head it may have read. */
const sentBackRead = (
  field: FieldLens,
  value: unknown,
  reads: ReadonlyArray<Readonly<ContentData>>,
  visible: ReadonlySet<string> | null,
): boolean => reads.some((read) => matchesRead(field, value, read[field.fieldId], visible));

type Walk = {
  issues: ContentIssue[];
  /** Refusals about item IDs and pairing: today's `CONTENT_INVALID` issues, in the client's API IDs. */
  itemIssues: ContentIssue[];
  /** Fields inside components the caller may not write (JSON pointers in the client's API IDs). */
  forbidden: string[];
  base: LensWriteBase;
  view: CallerView;
};

/**
 * The counterparts of one written object: what it is written over (the entry's base, or the stored item a
 * component item is paired with) and what the caller read of it (the entry: every head it may have read; an
 * item: the read of that same stored item, when the caller may have read it).
 */
type Counterpart = {
  stored: Readonly<ContentData> | null;
  reads: ReadonlyArray<Readonly<ContentData>>;
  /** A stored item the caller may not have read (the draft, without draft access): nothing is sent back. */
  unseen?: boolean;
  /** Where the object sits, for the caller's view: whether it reads there and sees the stored items. */
  scope: ViewScope;
  /** The same object in the other heads the caller may read (`LensWriteBase.shown`). */
  shown?: ReadonlyArray<Readonly<Record<string, unknown>>>;
};

const recordOrNull = (value: unknown): Readonly<ContentData> | null => (isRecord(value) ? value : null);

/** Whether the caller may write a top-level field that exists today (its write mask). */
const mayWriteToday = (base: LensWriteBase, field: FieldLens): boolean =>
  base.writable?.(field.fieldId) ?? true;

const writesEverything = (base: LensWriteBase): boolean =>
  base.writesEverything ?? base.writable === undefined;

/**
 * Whether a field removed since may be named as such, as reads name it (they show it as null): for a grant
 * naming no fields, and only if it was public at the client's version, at any depth. Anything else is answered
 * as a field the version does not have.
 */
const mayNameRemoved = (base: LensWriteBase, field: FieldLens): boolean =>
  field.client.public && !field.client.deprecated && writesEverything(base);

const UNKNOWN_FIELD = 'is not a field of this schema version';

/**
 * A field removed since, sent back empty by a caller a read through the client's version shows it to (as null):
 * that read sent back, so left out, whatever the caller's write grant names. Never refused.
 */
const echoesRemovedNull = (base: LensWriteBase, field: FieldLens | undefined, item: unknown): boolean =>
  field !== undefined && !field.stored && isMissingValue(item) && shownToWriter(base, field);

/** Whether the caller reads a field today (one it does not reads empty through the lens). */
const readsToday = (base: LensWriteBase, field: FieldLens, whole: boolean): boolean => {
  if (!field.stored || field.stored.deprecated) {
    return false;
  }
  const check = whole ? base.componentFieldReadable : base.readable;
  return check ? check(field.fieldId) : field.stored.public;
};

/**
 * One written object (the entry, or a component instance) in today's API IDs, recording the pairing of every
 * component list it writes in `pairings`. `whole`: a component instance, written whole, so what the client
 * cannot write or does not know keeps its stored value.
 */
const translateObject = (
  walk: Walk,
  lens: DefinitionLens,
  value: Readonly<Record<string, unknown>>,
  counterpart: Counterpart,
  path: string,
  whole: boolean,
  pairings: Map<string, Pairing>,
): Record<string, unknown> => {
  const output: Record<string, unknown> = {};
  const readNothing = walk.base.mayRead === false || counterpart.reads.length === 0;
  for (const [key, item] of Object.entries(value)) {
    if (key === COMPONENT_KEY) {
      continue;
    }
    if (whole && key === ITEM_ID_FIELD) {
      // The instance's ID (plan item-ids): which stored instance it continues, passed on as sent.
      output[ITEM_ID_FIELD] = item;
      continue;
    }
    const fieldPath = pointer(path, key);
    const field = fieldByApiKey(lens, key);
    // A field removed since resolves by its ID only (never by its API ID, which a field added since may reuse):
    // named as removed where the caller may learn it, else a field this version does not have.
    if (!field || (!field.stored && !mayNameRemoved(walk.base, field))) {
      if (!echoesRemovedNull(walk.base, field, item)) {
        walk.issues.push({ path: fieldPath, code: 'UNKNOWN_FIELD', message: UNKNOWN_FIELD });
      }
      continue;
    }
    // A field inside a component the caller's audience cannot write today. If a read through the client's version
    // shows it to this caller (as null, since today hides it), an empty value is that read sent back: left out,
    // so the stored value stays, whatever changed since (deprecated, made private). Anything else, and any value
    // at all for a field that read never shows (private at the version), is refused (403), as without a version.
    if (
      whole &&
      field.stored &&
      item !== undefined &&
      walk.base.componentFieldWritable &&
      !walk.base.componentFieldWritable(field.fieldId)
    ) {
      if (!(isMissingValue(item) && shownToWriter(walk.base, field))) {
        walk.forbidden.push(fieldPath);
      }
      continue;
    }
    // A caller that read nothing (no read access, or no head to read) cannot send anything back: its empty values
    // clear what they name, through the rules below, never keep it.
    if (!readNothing && field.stored && !readsToday(walk.base, field, whole) && isMissingValue(item)) {
      // The empty value a hidden field reads as, sent back: left out, so the stored value stays.
      continue;
    }
    if (!whole && field.stored && !mayWriteToday(walk.base, field)) {
      // Not the caller's to write today: today's answer, whatever changed since (no lens reason, no oracle).
      output[field.stored.apiKey] = item;
      continue;
    }
    if (isWritable(field)) {
      output[field.stored.apiKey] = translateValue(
        walk,
        field,
        item,
        counterpart,
        fieldPath,
        pairings,
        walk.view.inside(counterpart.scope, field.stored, !whole),
      );
    } else if (!sentBackRead(field, item, counterpart.reads, walk.base.visibleTargets ?? null)) {
      walk.issues.push(counterpart.unseen ? unseenRefusal(fieldPath) : refusal(field, fieldPath));
    }
    // Sent back as read: left out. What a written instance leaves out (fields the client cannot read, write or
    // does not know) is carried over in storage form by the write path (`keepUnreadableComponentFields`).
  }
  return output;
};

const translateInstance = (
  walk: Walk,
  lens: DefinitionLens,
  value: unknown,
  counterpart: Counterpart,
  path: string,
  pairings: Map<string, Pairing>,
): unknown =>
  isRecord(value) ? translateObject(walk, lens, value, counterpart, path, true, pairings) : value;

const translateZoneItem = (
  walk: Walk,
  field: FieldLens & { kind: 'same' },
  item: unknown,
  counterpart: Counterpart,
  path: string,
  pairings: Map<string, Pairing>,
): unknown => {
  if (!isRecord(item)) {
    return item;
  }
  const lens = zoneLensOf(field, item);
  if (!usable(lens) || lens.storedApiKey === null) {
    walk.issues.push({
      path: pointer(path, COMPONENT_KEY),
      code: 'UNKNOWN_COMPONENT',
      message: 'is not a component this field allows in this schema version',
    });
    return item;
  }
  // A paired stored item holds the same component (the pairing key and the in-place rule both say so).
  return {
    ...translateObject(walk, lens, item, counterpart, path, true, pairings),
    [COMPONENT_KEY]: lens.storedApiKey,
  };
};

/** The zone lens of a sent item, by the client's component API ID. */
const zoneLensOf = (field: FieldLens, item: unknown): DefinitionLens | null | undefined =>
  isRecord(item)
    ? [...(field.kind === 'null' ? [] : (field.nested?.components.values() ?? []))].find(
        (candidate) => candidate?.apiKey === item[COMPONENT_KEY],
      )
    : undefined;

/** The lens of a stored item of a list field (zones: by the component it holds); undefined when not shown. */
const storedItemLensOf = (field: FieldLens & { kind: 'same' }, item: unknown): DefinitionLens | undefined => {
  const lens =
    field.client.type === 'component'
      ? nestedOf(field, field.client.settings.component)
      : isRecord(item) && typeof item[COMPONENT_KEY] === 'string'
        ? nestedOf(field, item[COMPONENT_KEY])
        : undefined;
  return usable(lens) ? lens : undefined;
};

/** The lens of a sent item of a list field (zones: by the client's component API ID). */
const sentItemLensOf = (field: FieldLens & { kind: 'same' }, item: unknown): DefinitionLens | undefined => {
  const lens =
    field.client.type === 'component'
      ? nestedOf(field, field.client.settings.component)
      : zoneLensOf(field, item);
  return usable(lens) ? lens : undefined;
};

/** What the caller sees of a sent instance (client API IDs, as echoed from a read): its pairing key's content. */
const sentView = (
  walk: Walk,
  scope: ViewScope | 'whole',
  lens: DefinitionLens,
  item: Readonly<Record<string, unknown>>,
) => {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(item)) {
    const field = key === COMPONENT_KEY ? undefined : fieldByApiKey(lens, key);
    if (!field || field.kind === 'null' || !shownIn(walk, scope, field) || isMissingValue(value)) {
      continue;
    }
    output[key] = viewOf(
      field,
      value,
      (nested, instance) => sentView(walk, scope, nested, instance),
      (v) => echoed(field, v),
    );
  }
  return output;
};

/**
 * Whether a read at `scope` shows this field of an item (`CallerView.shows`, by today's definition). `whole`: every
 * field, nothing cut (a list the caller writes in full where it cannot see the items: `CallerView.wholeKey`).
 */
const shownIn = (walk: Walk, scope: ViewScope | 'whole', field: FieldLens): boolean =>
  field.stored !== undefined &&
  field.stored !== null &&
  (scope === 'whole' || walk.view.shows(scope, field.stored));

/** What the caller sees of a stored instance through the lens (read, cut to its view, in input form). */
const readView = (
  walk: Walk,
  scope: ViewScope | 'whole',
  lens: DefinitionLens,
  read: Readonly<Record<string, unknown>>,
) => {
  const output: Record<string, unknown> = {};
  for (const field of lens.fields) {
    const value = read[field.fieldId];
    // A value that does not fit the client's field reads as empty (the projection's own test: `matchesFieldType`).
    if (
      field.kind === 'null' ||
      !shownIn(walk, scope, field) ||
      isMissingValue(value) ||
      !matchesFieldType(field.client, value)
    ) {
      continue;
    }
    const leaf = fieldInputForm(field, scope === 'whole' ? value : cutRead(walk.view.access, field, value));
    if (isMissingValue(leaf) || (Array.isArray(leaf) && leaf.length === 0)) {
      continue;
    }
    output[field.apiKey] = viewOf(
      field,
      value,
      (nested, instance) => readView(walk, scope, nested, instance),
      () => leaf,
    );
  }
  return output;
};

/** A lensed leaf value as the caller's read shows it: relation targets and media it cannot see left out. */
const cutRead = (access: CallerAccess, field: FieldLens, value: unknown): unknown => {
  if (field.kind === 'null') {
    return value;
  }
  if (field.client.type === 'media' && access.visibleMedia !== null) {
    const visible = access.visibleMedia;
    return Array.isArray(value)
      ? value.filter((id) => typeof id === 'string' && visible.has(id))
      : typeof value === 'string' && visible.has(value)
        ? value
        : undefined;
  }
  return visibleRead(field, value, access.visibleTargets);
};

/**
 * One field's value in an item's view: component values item by item (zone items with their component's
 * definition ID, so a sent item and a stored one compare alike), anything else by `leaf`.
 */
const viewOf = (
  field: FieldLens & { kind: 'same' | 'convert' },
  value: unknown,
  instance: (lens: DefinitionLens, item: Readonly<Record<string, unknown>>) => unknown,
  leaf: (value: unknown) => unknown,
): unknown => {
  const { client } = field;
  const one = (lens: DefinitionLens | null | undefined, item: unknown) =>
    lens && isRecord(item) ? { kind: lens.definitionId, seen: instance(lens, item) } : item;
  if (client.type === 'component') {
    const lens = nestedOf(field, client.settings.component);
    return Array.isArray(value) ? value.map((item) => one(lens, item)) : one(lens, value);
  }
  if (client.type === 'dynamiczone' && Array.isArray(value)) {
    return value.map((item: unknown) => {
      const kind = isRecord(item) ? item[COMPONENT_KEY] : undefined;
      // Sent items name the client's component API ID, read items its definition ID.
      const lens = zoneLensOf(field, item) ?? (typeof kind === 'string' ? nestedOf(field, kind) : undefined);
      return one(lens, item);
    });
  }
  return leaf(value);
};

/** Whether the caller reads a component field (at any depth) today: its mask, else the field's `public`. */
const componentReadable =
  (base: LensWriteBase, lens: DefinitionLens) =>
  (fieldId: string): boolean => {
    const field = lens.fields.find((candidate) => candidate.fieldId === fieldId);
    return field !== undefined && readsToday(base, field, true);
  };

/** What the caller read of a stored component instance: the lens's read, cut to what it may read today. */
const readOfStored = (
  base: LensWriteBase,
  lens: DefinitionLens,
  stored: Readonly<ContentData>,
): ContentData => {
  const readable = componentReadable(base, lens);
  return readableThroughLens(lens, readThroughLens(lens, stored), readable, (fieldId) =>
    base.componentFieldReadable ? base.componentFieldReadable(fieldId) : readable(fieldId),
  );
};

/**
 * The base with a component-field read check at any depth: the one given, else each field's `public` flag today
 * (deprecated fields are never readable), found through the lens by stable ID.
 */
const withComponentReadability = (lens: DefinitionLens, base: LensWriteBase): LensWriteBase => {
  if (base.componentFieldReadable) {
    return base;
  }
  const fields = new Map<string, FieldLens>();
  const seen = new Set<string>();
  const collect = (current: DefinitionLens) => {
    if (seen.has(current.definitionId)) {
      return;
    }
    seen.add(current.definitionId);
    for (const field of current.fields) {
      fields.set(field.fieldId, field);
      for (const nested of field.kind === 'null' ? [] : (field.nested?.components.values() ?? [])) {
        if (nested) {
          collect(nested);
        }
      }
    }
  };
  collect(lens);
  return {
    ...base,
    componentFieldReadable: (fieldId) => {
      const field = fields.get(fieldId);
      return (
        field?.stored !== undefined &&
        field.stored !== null &&
        !field.stored.deprecated &&
        field.stored.public
      );
    },
  };
};

/** The counterpart of a sent instance paired with `stored` (or none: a new item). */
const counterpartOf = (
  base: LensWriteBase,
  lens: DefinitionLens,
  stored: Readonly<ContentData> | null,
  scope: ViewScope,
  shown: ReadonlyArray<Readonly<Record<string, unknown>>>,
): Counterpart => {
  const elsewhere = shown.length > 0 ? { shown } : {};
  if (!stored) {
    // A new item the client copied from another head it read (`shownElsewhere`): what it sends back of that read
    // is that read sent back (a field it cannot write through its version is left out), never refused.
    return {
      stored: null,
      reads: scope.reads ? shown.map((item) => readOfStored(base, lens, item)) : [],
      scope,
      ...elsewhere,
    };
  }
  return {
    stored,
    reads: scope.sees ? [readOfStored(base, lens, stored)] : [],
    unseen: !scope.sees && scope.reads,
    scope,
    ...elsewhere,
  };
};

/** The ID a sent item names (`id`): a string, null when sent as new, undefined when it sends none. */
const sentIdOf = (item: unknown): string | null | undefined =>
  isRecord(item) && Object.hasOwn(item, ITEM_ID_FIELD) && item[ITEM_ID_FIELD] !== undefined
    ? typeof item[ITEM_ID_FIELD] === 'string' && item[ITEM_ID_FIELD] !== ''
      ? item[ITEM_ID_FIELD]
      : null
    : undefined;

/** A stored instance's ID (every stored instance has one: `withItemIds`). */
const storedIdOf = (item: unknown): string | null =>
  isRecord(item) && typeof item[ITEM_ID_KEY] === 'string' ? item[ITEM_ID_KEY] : null;

/**
 * The one pairing of a written list (`listPairing.ts`): each sent item with the stored item (of the list it
 * is written over) it continues, by the item IDs the client sent, else by everything the caller sees of both
 * through the lens. Its refusals (item IDs, ambiguity) are `CONTENT_INVALID` issues.
 */
const pairWrittenList = (
  walk: Walk,
  field: FieldLens & { kind: 'same' },
  sent: readonly unknown[],
  stored: readonly unknown[],
  shownIds: ReadonlySet<string>,
  path: string,
  scope: ViewScope,
): number[] => {
  const side = (
    items: readonly unknown[],
    lensOf: (item: unknown) => DefinitionLens | undefined,
    view: (lens: DefinitionLens, item: Readonly<Record<string, unknown>>) => unknown,
  ) => ({
    keys: items.map((item) => {
      const lens = lensOf(item);
      return lens && isRecord(item) ? itemKey({ kind: lens.definitionId, seen: view(lens, item) }) : null;
    }),
    kinds: items.map((item) => lensOf(item)?.definitionId ?? null),
  });
  const unseen = !scope.sees;
  const hidden = walk.view.holdsHidden(scope, field.stored);
  const sentIds = sent.map(sentIdOf);
  // Keys are made only for a list sent without IDs: where the caller sees the items, of what it sees; where it
  // does not, of whole items, and only for a list it writes in full (one that can hold more is never compared).
  // A list naming IDs the draft lacks is keyed too where the caller sees its items and nothing in them is
  // hidden from it: those items pair as they would without IDs (listPairing.ts).
  const storedIds = new Set(stored.map(storedIdOf));
  const copiesItems =
    scope.sees && !hidden && sentIds.some((id) => typeof id === 'string' && !storedIds.has(id));
  const compares = (sentIds.every((id) => id === undefined) && (scope.sees || !hidden)) || copiesItems;
  const keyScope: ViewScope | 'whole' = scope.sees ? scope : 'whole';
  const sentSide = side(
    compares ? sent : [],
    (item) => sentItemLensOf(field, item),
    (lens, item) => sentView(walk, keyScope, lens, item),
  );
  const storedSide = side(
    compares ? stored : [],
    (item) => storedItemLensOf(field, item),
    (lens, item) => readView(walk, keyScope, lens, readThroughLens(lens, item)),
  );
  const kinds = (items: readonly unknown[], lensOf: (item: unknown) => DefinitionLens | undefined) =>
    items.map((item) => lensOf(item)?.definitionId ?? null);
  const { pairs, issues } = pairList(
    {
      sentIds,
      sent: { keys: sentSide.keys, kinds: kinds(sent, (item) => sentItemLensOf(field, item)) },
      storedIds: stored.map(storedIdOf),
      stored: { keys: storedSide.keys, kinds: kinds(stored, (item) => storedItemLensOf(field, item)) },
      shownIds,
    },
    { hidden, unseen, fresh: scope.fresh === true, readsDrafts: walk.view.access.readsDrafts === true },
  );
  walk.itemIssues.push(...issues.map((issue) => itemIssueOf(issue, path, { unseen })));
  return pairs;
};

/**
 * Every component list and zone in a body in the client's API IDs, at any depth, holds at most the items a write
 * pairs (today's field's `max`, at most `CARRY_MAX_ITEMS`): the validator's own `TOO_MANY` otherwise, checked
 * with the body before anything else is (`assertListCap` checks the same during the translation).
 */
export const assertClientListCaps = (lens: DefinitionLens, body: unknown, path = ''): void => {
  if (!isRecord(body)) {
    return;
  }
  for (const [key, value] of Object.entries(body)) {
    const field = key === COMPONENT_KEY ? undefined : fieldByApiKey(lens, key);
    if (!field || field.kind === 'null') {
      continue;
    }
    const { client } = field;
    if (client.type !== 'component' && client.type !== 'dynamiczone') {
      continue;
    }
    const fieldPath = pointer(path, key);
    const items = Array.isArray(value) ? value : [value];
    if (Array.isArray(value)) {
      const cap = listCapOf(field.stored.settings);
      if (value.length > cap) {
        throw listTooLong(fieldPath, cap);
      }
    }
    items.forEach((item: unknown, index) => {
      const nested =
        client.type === 'component' ? nestedOf(field, client.settings.component) : zoneLensOf(field, item);
      if (usable(nested)) {
        assertClientListCaps(nested, item, Array.isArray(value) ? pointer(fieldPath, index) : fieldPath);
      }
    });
  }
};

/** A list longer than the write path considers: the validator's own `TOO_MANY`, before any pairing. */
const assertListCap = (field: FieldLens & { kind: 'same' }, value: readonly unknown[], path: string) => {
  const cap = listCapOf(field.stored.settings);
  if (value.length > cap) {
    throw listTooLong(path, cap);
  }
};

function translateValue(
  walk: Walk,
  field: FieldLens & { kind: 'same' },
  value: unknown,
  parent: Counterpart,
  path: string,
  pairings: Map<string, Pairing>,
  scope: ViewScope,
): unknown {
  const { client } = field;
  const stored = parent.stored?.[field.fieldId];
  // What another head the caller may read shows here (`shownElsewhere` in listPairing.ts), by item ID.
  const shownHere = shownItemsAt(
    (parent.shown ?? []).map((head) => head[field.fieldId]),
    scope.reads,
  );
  if (client.type === 'component' && !Array.isArray(value)) {
    const lens = nestedOf(field, client.settings.component);
    if (!usable(lens) || !isRecord(value)) {
      return value;
    }
    const sentId = sentIdOf(value);
    const single = pairSingle(sentId, storedIdOf(stored), isRecord(stored), {
      ids: new Set(shownHere.keys()),
      policy: {
        hidden: walk.view.holdsHidden(scope, field.stored),
        unseen: !scope.sees,
        fresh: scope.fresh === true,
        readsDrafts: walk.view.access.readsDrafts === true,
      },
    });
    walk.itemIssues.push(...single.issues.map((issue) => itemIssueOf(issue, path)));
    const instance = single.pairs[0] === 0 ? recordOrNull(stored) : null;
    const inside = new Map<string, Pairing>();
    const translated = translateInstance(
      walk,
      lens,
      value,
      counterpartOf(
        walk.base,
        lens,
        instance,
        walk.view.within(scope, instance !== null),
        shownCounterparts(shownHere, sentId, instance),
      ),
      path,
      inside,
    );
    pairings.set(field.fieldId, { pairs: single.pairs, inside: [inside] });
    return translated;
  }
  if ((client.type !== 'component' && client.type !== 'dynamiczone') || !Array.isArray(value)) {
    return value;
  }
  assertListCap(field, value, path);
  const kept = Array.isArray(stored) ? stored.slice(0, CARRY_MAX_ITEMS) : [];
  const pairs = pairWrittenList(walk, field, value, kept, new Set(shownHere.keys()), path, scope);
  const inside: Array<Map<string, Pairing>> = [];
  const translated = value.map((item: unknown, index) => {
    const pair = pairs[index] ?? -1;
    const storedItem = pair === -1 ? null : recordOrNull(kept[pair]);
    const lens = sentItemLensOf(field, item);
    const counterpart = lens
      ? counterpartOf(
          walk.base,
          lens,
          storedItem,
          walk.view.within(scope, storedItem !== null),
          shownCounterparts(shownHere, sentIdOf(item), storedItem),
        )
      : { stored: null, reads: [], scope };
    const nested = new Map<string, Pairing>();
    inside.push(nested);
    const itemPath = pointer(path, index);
    if (client.type === 'dynamiczone') {
      return translateZoneItem(walk, field, item, counterpart, itemPath, nested);
    }
    return lens ? translateInstance(walk, lens, item, counterpart, itemPath, nested) : item;
  });
  pairings.set(field.fieldId, { pairs, inside });
  return translated;
}

/**
 * `input` (the client's write body, keyed by its API IDs) for today's write path. On update, fields the client
 * does not know are left untouched (a write is a patch), inside components and zone items too.
 */
export const writeThroughLens = (
  lens: DefinitionLens,
  input: Readonly<Record<string, unknown>>,
  base: LensWriteBase,
): LensWriteResult => {
  const withReadability = withComponentReadability(lens, base);
  const view = base.view ?? viewOfBase(lens, withReadability);
  const walk: Walk = { issues: [], itemIssues: [], forbidden: [], base: withReadability, view };
  const pairings = new Map<string, Pairing>();
  const output = translateObject(
    walk,
    lens,
    input,
    { stored: base.stored, reads: base.reads, scope: view.top, ...(base.shown ? { shown: base.shown } : {}) },
    '',
    false,
    pairings,
  );
  // A list refused as ambiguous answers for itself: a field inside its items was judged against no stored item,
  // so the version's refusals there say nothing true (they are left out, the ambiguity is reported).
  const ambiguous = new Set(
    walk.itemIssues.filter((issue) => issue.code === 'AMBIGUOUS_ITEMS').map((issue) => issue.path),
  );
  // Each issue looks its own path's prefixes up (linear in the issues and their depth, never issues x lists).
  const underAmbiguous = (path: string) => {
    for (let at = path.length; at > 0; at = path.lastIndexOf('/', at - 1)) {
      if (ambiguous.has(path.slice(0, at))) {
        return true;
      }
    }
    return false;
  };
  const issues =
    ambiguous.size === 0 ? walk.issues : walk.issues.filter((issue) => !underAmbiguous(issue.path));
  return { input: output, issues, itemIssues: walk.itemIssues, forbidden: walk.forbidden, pairings };
};

/** The longest item ID a body may name (the validator's own limit). */
const MAX_ITEM_ID_LENGTH = 64;

/**
 * What a body through a schema version answers before anything else is decided, in the order a body without a
 * version does (delivery-api.md): the body's own refusals (`issues`: an unknown field, an unknown component in a
 * zone, an item ID of the wrong type; `CONTENT_INVALID`, 422), then fields inside components the caller may not
 * write (`forbidden`, 403). Nothing is paired and nothing stored is read: a stale version is answered right after.
 * The translation repeats these checks; this pass only answers them first.
 */
export const checkClientBody = (
  lens: DefinitionLens,
  body: Readonly<Record<string, unknown>>,
  base: LensWriteBase,
): { issues: ContentIssue[]; forbidden: string[] } => {
  const issues: ContentIssue[] = [];
  const forbidden: string[] = [];
  const objectOf = (
    current: DefinitionLens,
    value: Readonly<Record<string, unknown>>,
    path: string,
    whole: boolean,
  ) => {
    for (const [key, item] of Object.entries(value)) {
      if (key === COMPONENT_KEY) {
        continue;
      }
      if (whole && key === ITEM_ID_FIELD) {
        if (
          item !== undefined &&
          item !== null &&
          !(typeof item === 'string' && item !== '' && item.length <= MAX_ITEM_ID_LENGTH)
        ) {
          issues.push({ path: pointer(path, key), code: 'INVALID_TYPE', message: 'must be an item ID' });
        }
        continue;
      }
      const fieldPath = pointer(path, key);
      const field = fieldByApiKey(current, key);
      if (!field || (!field.stored && !mayNameRemoved(base, field))) {
        if (!echoesRemovedNull(base, field, item)) {
          issues.push({ path: fieldPath, code: 'UNKNOWN_FIELD', message: UNKNOWN_FIELD });
        }
        continue;
      }
      if (
        whole &&
        field.stored &&
        item !== undefined &&
        base.componentFieldWritable &&
        !base.componentFieldWritable(field.fieldId)
      ) {
        if (!(isMissingValue(item) && shownToWriter(base, field))) {
          forbidden.push(fieldPath);
        }
        continue;
      }
      if (field.kind === 'null' || !field.stored) {
        continue;
      }
      const { client } = field;
      if (client.type === 'component') {
        const nested = nestedOf(field, client.settings.component);
        if (!usable(nested)) {
          continue;
        }
        if (Array.isArray(item)) {
          item.forEach((entry: unknown, index) => {
            if (isRecord(entry)) {
              objectOf(nested, entry, pointer(fieldPath, index), true);
            }
          });
        } else if (isRecord(item)) {
          objectOf(nested, item, fieldPath, true);
        }
      } else if (client.type === 'dynamiczone' && Array.isArray(item)) {
        item.forEach((entry: unknown, index) => {
          const at = pointer(fieldPath, index);
          const nested = zoneLensOf(field, entry);
          if (!usable(nested) || nested.storedApiKey === null) {
            issues.push({
              path: pointer(at, COMPONENT_KEY),
              code: 'UNKNOWN_COMPONENT',
              message: 'is not a component this field allows in this schema version',
            });
          } else if (isRecord(entry)) {
            objectOf(nested, entry, at, true);
          }
        });
      }
    }
  };
  objectOf(lens, body, '', false);
  return { issues, forbidden };
};

/** A caller view from a write base (when the write path did not give one): its checks, the version's fields. */
const viewOfBase = (lens: DefinitionLens, base: LensWriteBase): CallerView => {
  const access: CallerAccess = {
    mayRead: base.mayRead !== false,
    seesStored: base.seesStored !== false,
    readsField: (field) => !field.deprecated && (base.readable ? base.readable(field.id) : field.public),
    readsComponentField: (field) =>
      !field.deprecated &&
      (base.componentFieldReadable ? base.componentFieldReadable(field.id) : field.public),
    writesComponentField: (field) =>
      !field.deprecated && (base.componentFieldWritable ? base.componentFieldWritable(field.id) : true),
    visibleTargets: base.visibleTargets ?? null,
    visibleMedia: null,
    neverRefuses: false,
  };
  const components = new Map<string, ComponentDefinition>();
  const definition = (id: string) => {
    const found = base.definitionOf(id);
    return found && isComponentDefinition(found) ? found : undefined;
  };
  return callerViewOf(
    access,
    (id) => {
      const known = components.get(id) ?? definition(id);
      if (known) {
        components.set(id, known);
      }
      return known;
    },
    lensFieldSet(lens),
  );
};

/**
 * What the lens read (`readThroughLens`) of an entry, without what the caller may not read today: top-level
 * fields by `visible`, component fields (at any depth) by `componentFieldVisible`. A write compares against
 * this only, so a refusal never tells a caller whether it guessed a hidden value.
 */
export const readableThroughLens = (
  lens: DefinitionLens,
  data: Readonly<ContentData>,
  visible: (fieldId: string) => boolean,
  componentFieldVisible: (fieldId: string) => boolean,
): ContentData => {
  const restrict = (current: DefinitionLens, item: unknown, show: (fieldId: string) => boolean): unknown => {
    if (!isRecord(item)) {
      return item;
    }
    const output: ContentData = {};
    for (const field of current.fields) {
      const value = item[field.fieldId];
      if (isMissingValue(value) || !show(field.fieldId)) {
        continue;
      }
      output[field.fieldId] = restrictValue(field, value);
    }
    if (typeof item[COMPONENT_KEY] === 'string') {
      output[COMPONENT_KEY] = item[COMPONENT_KEY];
    }
    if (typeof item[ITEM_ID_KEY] === 'string') {
      output[ITEM_ID_KEY] = item[ITEM_ID_KEY];
    }
    return output;
  };
  const restrictValue = (field: FieldLens, value: unknown): unknown => {
    if (field.kind === 'null') {
      return value;
    }
    const nested = (componentId: unknown, item: unknown) => {
      const component = typeof componentId === 'string' ? nestedOf(field, componentId) : undefined;
      return component ? restrict(component, item, componentFieldVisible) : item;
    };
    if (field.client.type === 'component') {
      const componentId = field.client.settings.component;
      return Array.isArray(value)
        ? value.map((item) => nested(componentId, item))
        : nested(componentId, value);
    }
    if (field.client.type === 'dynamiczone' && Array.isArray(value)) {
      return value.map((item: unknown) => nested(isRecord(item) ? item[COMPONENT_KEY] : undefined, item));
    }
    return value;
  };
  return restrict(lens, data, visible) as ContentData;
};

const ADDED_SINCE =
  "(this field was added after the client's schema version; update the client to the current schema version to write it)";

const decodeSegment = (segment: string) => segment.replace(/~1/g, '/').replace(/~0/g, '~');

/** One JSON pointer in today's API IDs in the client's, and whether it names a field the client lacks. */
const clientPath = (
  lens: DefinitionLens,
  path: string,
  base: Pick<LensWriteBase, 'definitionOf'>,
): { path: string; added: boolean } => {
  const segments = path.split('/').slice(1).map(decodeSegment);
  const output: string[] = [];
  let current: DefinitionLens | null | undefined = lens;
  let index = 0;
  let added = false;
  while (index < segments.length && current) {
    const segment = segments[index] as string;
    const field: FieldLens | undefined = current.fields.find(
      (candidate) => candidate.kind !== 'null' && candidate.stored.apiKey === segment,
    );
    if (!field || field.kind === 'null') {
      const today = base.definitionOf(current.definitionId);
      added = current.addedFieldIds.some(
        (id) => today?.fields.find((candidate) => candidate.id === id)?.apiKey === segment,
      );
      break;
    }
    output.push(field.apiKey);
    index += 1;
    const next = segments[index];
    const listed = next !== undefined && /^\d+$/.test(next);
    if (field.client.type === 'component') {
      current = nestedOf(field, field.client.settings.component);
      if (listed && field.client.settings.repeatable) {
        output.push(next);
        index += 1;
      }
    } else if (
      field.client.type === 'dynamiczone' &&
      listed &&
      field.client.settings.components.length === 1
    ) {
      output.push(next);
      index += 1;
      current = nestedOf(field, field.client.settings.components[0] as string);
    } else {
      current = null;
    }
  }
  const rest = segments.slice(index);
  return {
    path: [...output, ...rest].reduce((joined, segment) => pointer(joined, segment), ''),
    added,
  };
};

/**
 * Today's validation issues in the client's API IDs: pointers renamed by stable ID, and an issue on a field
 * the client's version lacks (a required field added since) says so.
 */
export const issuesInClientNames = (
  lens: DefinitionLens,
  issues: readonly ContentIssue[],
  base: Pick<LensWriteBase, 'definitionOf'>,
): ContentIssue[] =>
  issues.map((issue) => {
    const { path, added } = clientPath(lens, issue.path, base);
    return { ...issue, path, message: added ? `${issue.message} ${ADDED_SINCE}` : issue.message };
  });

/** Today's API ID of a top-level field in the client's (a `FORBIDDEN_FIELD` list). */
export const clientApiKey = (lens: DefinitionLens, apiKey: string): string =>
  lens.fields.find((field) => field.kind !== 'null' && field.stored.apiKey === apiKey)?.apiKey ?? apiKey;
