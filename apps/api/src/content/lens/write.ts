import { canonicalJson, type DefinitionLens, type FieldLens, type SchemaDefinition } from '@shapio/schema';
import type { ContentData } from '../../db/contentData.js';
import { COMPONENT_KEY, isMissingValue } from '../validator/index.js';
import { pointer, type ContentIssue } from '../validator/issues.js';
import { CARRY_MAX_ITEM_KEY, CARRY_MAX_ITEMS, listTooLong, pairItems } from '../write/keepUnreadable.js';

/**
 * A write body in the client's schema version (its API IDs) for today's write path (plan schema-lenses,
 * limited writes). Fields that read exactly as stored (`same`, renames allowed) and kept their localization
 * are translated, into components and dynamic-zone items. Any other field is an issue, unless its value equals
 * what the lens reads for the entry today: the client sent back what it read, and the stored value is kept
 * untouched (never the converted value written back). A component instance is written whole, so inside one
 * the fields the client cannot write or does not know keep their stored values (items matched by position,
 * dynamic-zone items only when they hold the same component). Values are never converted: today's validator
 * checks what is forwarded.
 */
export type LensWriteResult = {
  /** The body in today's API IDs, for the unchanged write path (`fromInput`, validation, storage). */
  input: Record<string, unknown>;
  /** Fields that cannot be written through the lens, by JSON pointer in the client's API IDs. */
  issues: ContentIssue[];
};

/** What a write through the lens is checked against. */
export type LensWriteBase = {
  /** The entry's draft today, in storage form (field IDs); null on create. */
  stored: Readonly<ContentData> | null;
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
   * The caller's write grant names no fields: only then is a field removed since refused with the lens's reason;
   * for anyone else it is a field that does not exist (today's unknown-field answer).
   */
  writesEverything?: boolean;
};

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
    if (key === COMPONENT_KEY) {
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

type Walk = { issues: ContentIssue[]; base: LensWriteBase };

/** The counterparts of one written object: today's stored one and what the lens read of it. */
type Counterpart = { stored: Readonly<ContentData> | null; reads: ReadonlyArray<Readonly<ContentData>> };

/** The counterparts of each read at one position (a component instance, a list item). */
const readsAt = (
  reads: ReadonlyArray<Readonly<ContentData>>,
  fieldId: string,
  index?: number,
): Array<Readonly<ContentData>> =>
  reads.flatMap((read) => {
    const value = index === undefined ? read[fieldId] : at(read[fieldId], index);
    return isRecord(value) ? [value] : [];
  });

const recordOrNull = (value: unknown): Readonly<ContentData> | null => (isRecord(value) ? value : null);

const at = (value: unknown, index: number): unknown => (Array.isArray(value) ? value[index] : undefined);

/**
 * One written object (the entry, or a component instance) in today's API IDs. `whole`: a component instance,
 * written whole, so what the client cannot write or does not know keeps its stored value.
 */
/** Whether the caller may write a top-level field today; a field removed since only with a no-fields grant. */
const mayWriteToday = (base: LensWriteBase, field: FieldLens): boolean =>
  field.stored ? (base.writable?.(field.fieldId) ?? true) : base.writesEverything === true;

const translateObject = (
  walk: Walk,
  lens: DefinitionLens,
  value: Readonly<Record<string, unknown>>,
  counterpart: Counterpart,
  path: string,
  whole: boolean,
): Record<string, unknown> => {
  const output: Record<string, unknown> = {};
  const readNothing = walk.base.mayRead === false || walk.base.reads.length === 0;
  /** Whether the caller reads the field today; one it does not reads empty through the lens. */
  const readableToday = (field: FieldLens): boolean => {
    if (!field.stored || field.stored.deprecated) {
      return false;
    }
    const check = whole ? walk.base.componentFieldReadable : walk.base.readable;
    return check ? check(field.fieldId) : field.stored.public;
  };
  for (const [key, item] of Object.entries(value)) {
    if (key === COMPONENT_KEY) {
      continue;
    }
    const fieldPath = pointer(path, key);
    const field = fieldByApiKey(lens, key);
    if (!field) {
      walk.issues.push({
        path: fieldPath,
        code: 'UNKNOWN_FIELD',
        message: 'is not a field of this schema version',
      });
      continue;
    }
    // A caller that read nothing (no read access, or no head to read) cannot send anything back: its empty values
    // clear what they name, through the rules below, never keep it.
    if (!readNothing && field.stored && !readableToday(field) && isMissingValue(item)) {
      // The empty value a hidden field reads as, sent back: left out, so the stored value stays.
      continue;
    }
    if (!whole && walk.base.writable && !mayWriteToday(walk.base, field)) {
      // Not the caller's to write today: today's answer, whatever changed since (no lens reason, no oracle).
      output[field.stored ? field.stored.apiKey : key] = item;
      continue;
    }
    if (isWritable(field)) {
      output[field.stored.apiKey] = translateValue(walk, field, item, counterpart, fieldPath);
    } else if (!sentBackRead(field, item, counterpart.reads, walk.base.visibleTargets ?? null)) {
      walk.issues.push(refusal(field, fieldPath));
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
): unknown => (isRecord(value) ? translateObject(walk, lens, value, counterpart, path, true) : value);

const translateZoneItem = (
  walk: Walk,
  field: FieldLens & { kind: 'same' },
  item: unknown,
  counterpart: Counterpart,
  path: string,
): unknown => {
  if (!isRecord(item)) {
    return item;
  }
  const lens = [...(field.nested?.components.values() ?? [])].find(
    (candidate) => candidate?.apiKey === item[COMPONENT_KEY],
  );
  if (!usable(lens) || lens.storedApiKey === null) {
    walk.issues.push({
      path: pointer(path, COMPONENT_KEY),
      code: 'UNKNOWN_COMPONENT',
      message: 'is not a component this field allows in this schema version',
    });
    return item;
  }
  // Matched counterparts hold the same component (`listCounterparts`).
  return {
    ...translateObject(
      walk,
      lens,
      item,
      { stored: null, reads: counterpart.reads.filter((read) => read[COMPONENT_KEY] === lens.definitionId) },
      path,
      true,
    ),
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

/**
 * The read counterparts of each sent list item, matched as the write path's carry-over matches them
 * (`pairItems`): per head the client may have read, by what it sees of the item first, then in place when the
 * list kept its length. An item is compared with the item it continues, never just the one at its position.
 */
const listCounterparts = (
  field: FieldLens & { kind: 'same' },
  sent: readonly unknown[],
  reads: ReadonlyArray<Readonly<ContentData>>,
): Counterpart[] => {
  const single =
    field.client.type === 'component' ? nestedOf(field, field.client.settings.component) : undefined;
  const sentLens = (item: unknown) => (single !== undefined ? single : zoneLensOf(field, item));
  const kindOfSent = (item: unknown) => sentLens(item)?.definitionId ?? null;
  const kindOfRead = (item: unknown) =>
    field.client.type === 'component'
      ? (single?.definitionId ?? null)
      : isRecord(item)
        ? (item[COMPONENT_KEY] ?? null)
        : null;
  const sentKeys = sent.map((item) => {
    const lens = sentLens(item);
    return lens && isRecord(item)
      ? boundedItemKey(canonicalJson({ kind: kindOfSent(item), seen: echoedInstance(lens, item) }))
      : null;
  });
  const perHead = reads.map((read) => {
    const list = Array.isArray(read[field.fieldId])
      ? (read[field.fieldId] as unknown[]).slice(0, CARRY_MAX_ITEMS)
      : [];
    const readKeys = list.map((item) => {
      const kind = kindOfRead(item);
      const lens =
        field.client.type === 'component'
          ? single
          : typeof kind === 'string'
            ? nestedOf(field, kind)
            : undefined;
      return lens ? boundedItemKey(canonicalJson({ kind, seen: inputFormOf(lens, item) })) : null;
    });
    const pairs = pairItems(
      sentKeys,
      readKeys,
      (position) => kindOfSent(sent[position]) === kindOfRead(list[position]),
    );
    return { list, pairs };
  });
  return sent.map((_item, index) => ({
    stored: null,
    reads: perHead.flatMap(({ list, pairs }) => {
      const pair = pairs[index] ?? -1;
      const item = pair === -1 ? undefined : list[pair];
      return isRecord(item) ? [item] : [];
    }),
  }));
};

const boundedItemKey = (key: string): string | null => (key.length > CARRY_MAX_ITEM_KEY ? null : key);

/** A list longer than the write path considers: the validator's own `TOO_MANY`, before any matching. */
const assertListCap = (field: FieldLens & { kind: 'same' }, value: readonly unknown[], path: string) => {
  const max = (field.stored.settings as { max?: number }).max;
  const cap = max !== undefined && max < CARRY_MAX_ITEMS ? max : CARRY_MAX_ITEMS;
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
): unknown {
  const { client } = field;
  const stored = parent.stored?.[field.fieldId];
  if (client.type === 'component') {
    const lens = nestedOf(field, client.settings.component);
    if (!usable(lens)) {
      return value;
    }
    if (!Array.isArray(value)) {
      return translateInstance(
        walk,
        lens,
        value,
        { stored: recordOrNull(stored), reads: readsAt(parent.reads, field.fieldId) },
        path,
      );
    }
    assertListCap(field, value, path);
    const counterparts = listCounterparts(field, value, parent.reads);
    return value.map((item, index) =>
      translateInstance(walk, lens, item, counterparts[index] as Counterpart, pointer(path, index)),
    );
  }
  if (client.type === 'dynamiczone') {
    if (!Array.isArray(value)) {
      return value;
    }
    assertListCap(field, value, path);
    const counterparts = listCounterparts(field, value, parent.reads);
    return value.map((item, index) =>
      translateZoneItem(walk, field, item, counterparts[index] as Counterpart, pointer(path, index)),
    );
  }
  return value;
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
  const walk: Walk = { issues: [], base };
  const output = translateObject(walk, lens, input, { stored: base.stored, reads: base.reads }, '', false);
  return { input: output, issues: walk.issues };
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
