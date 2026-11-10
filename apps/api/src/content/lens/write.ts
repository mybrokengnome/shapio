import { canonicalJson, type DefinitionLens, type FieldLens } from '@shapio/schema';
import type { ContentData } from '../../db/contentData.js';
import { COMPONENT_KEY, isMissingValue } from '../validator/index.js';
import { pointer, type ContentIssue } from '../validator/issues.js';

/**
 * A write body in the client's schema version (its API IDs) for today's write path (plan schema-lenses,
 * limited writes). Only fields that read exactly as stored (`same`, renames allowed) and kept their
 * localization are translated, components inside them included when nothing was added to or changed in them
 * since (a component instance is written whole, so a field the client does not know would be dropped). Any
 * other field is an issue, unless its value equals what the lens reads for the entry today: then the client
 * sent back what it read, and the field is left untouched. Values are not converted: today's validator checks
 * what is forwarded.
 */
export type LensWriteResult = {
  /** The body in today's API IDs, for the unchanged write path (`fromInput`, validation, storage). */
  input: Record<string, unknown>;
  /** Fields that cannot be written through the lens, by JSON pointer in the client's API IDs. */
  issues: ContentIssue[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const fieldByApiKey = (lens: DefinitionLens, apiKey: string): FieldLens | undefined => {
  const fieldId = lens.apiKeyToFieldId.get(apiKey);
  return fieldId === undefined ? undefined : lens.fields.find((field) => field.fieldId === fieldId);
};

const nestedLenses = (field: FieldLens): Array<DefinitionLens | null> =>
  field.kind === 'null' ? [] : [...(field.nested?.components.values() ?? [])];

/** A component instance can be written in the client's shape: every field it has today is one it writes. */
const writableDefinition = (lens: DefinitionLens | null): boolean =>
  lens !== null &&
  (lens.status === 'identity' || lens.status === 'lensed') &&
  lens.addedFieldIds.length === 0 &&
  lens.fields.every(writableField);

function writableField(field: FieldLens): field is FieldLens & { kind: 'same' } {
  return (
    field.kind === 'same' &&
    field.client.localized === field.stored.localized &&
    nestedLenses(field).every(writableDefinition)
  );
}

type Walk = { issues: ContentIssue[] };

const unknownField = (walk: Walk, path: string) =>
  walk.issues.push({ path, code: 'UNKNOWN_FIELD', message: 'is not a field of this schema version' });

/** A component instance's fields in today's API IDs. */
const translateInstance = (walk: Walk, lens: DefinitionLens, value: unknown, path: string): unknown => {
  if (!isRecord(value)) {
    return value;
  }
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === COMPONENT_KEY) {
      continue;
    }
    const field = fieldByApiKey(lens, key);
    if (!field || field.kind !== 'same') {
      unknownField(walk, pointer(path, key));
      continue;
    }
    output[field.stored.apiKey] = translateValue(walk, field, item, pointer(path, key));
  }
  return output;
};

const translateZoneItem = (walk: Walk, field: FieldLens, item: unknown, path: string): unknown => {
  if (!isRecord(item)) {
    return item;
  }
  const lens = nestedLenses(field).find((candidate) => candidate?.apiKey === item[COMPONENT_KEY]);
  if (!lens?.storedApiKey) {
    walk.issues.push({
      path: pointer(path, COMPONENT_KEY),
      code: 'UNKNOWN_COMPONENT',
      message: 'is not a component this field allows in this schema version',
    });
    return item;
  }
  return { ...(translateInstance(walk, lens, item, path) as object), [COMPONENT_KEY]: lens.storedApiKey };
};

function translateValue(
  walk: Walk,
  field: FieldLens & { kind: 'same' },
  value: unknown,
  path: string,
): unknown {
  const { client } = field;
  if (client.type === 'component') {
    const lens = field.nested?.components.get(client.settings.component);
    if (!lens) {
      return value;
    }
    return Array.isArray(value)
      ? value.map((item, index) => translateInstance(walk, lens, item, pointer(path, index)))
      : translateInstance(walk, lens, value, path);
  }
  if (client.type === 'dynamiczone') {
    return Array.isArray(value)
      ? value.map((item, index) => translateZoneItem(walk, field, item, pointer(path, index)))
      : value;
  }
  return value;
}

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
    const lens = field.nested?.components.get(client.settings.component);
    if (!lens) {
      return value;
    }
    return Array.isArray(value) ? value.map((item) => inputFormOf(lens, item)) : inputFormOf(lens, value);
  }
  if (client.type === 'dynamiczone' && Array.isArray(value)) {
    return value.map((item: unknown): unknown => {
      const lens = isRecord(item) ? field.nested?.components.get(String(item[COMPONENT_KEY])) : undefined;
      return lens ? { ...(inputFormOf(lens, item) as object), [COMPONENT_KEY]: lens.apiKey } : item;
    });
  }
  return value;
};

/** Whether the client sent back exactly what it reads today (absent and empty count as the same). */
const sentBackRead = (field: FieldLens, value: unknown, read: Readonly<ContentData> | null): boolean => {
  const current = read?.[field.fieldId];
  if (isMissingValue(value) || isMissingValue(current)) {
    return isMissingValue(value) && isMissingValue(current);
  }
  return canonicalJson(value) === canonicalJson(fieldInputForm(field, current));
};

/**
 * `input` (the client's write body, keyed by its API IDs) for today's write path. `read` is what the lens reads
 * for the entry today (`readThroughLens` of its current draft; null on create, where nothing can be sent back).
 */
export const writeThroughLens = (
  lens: DefinitionLens,
  input: Readonly<Record<string, unknown>>,
  read: Readonly<ContentData> | null,
): LensWriteResult => {
  const walk: Walk = { issues: [] };
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    const path = pointer('', key);
    const field = fieldByApiKey(lens, key);
    if (!field) {
      unknownField(walk, path);
    } else if (writableField(field)) {
      output[field.stored.apiKey] = translateValue(walk, field, value, path);
    } else if (!sentBackRead(field, value, read)) {
      walk.issues.push({
        path,
        code: 'NOT_ALLOWED',
        message: 'changed since this schema version and cannot be written through it',
      });
    }
  }
  return { input: output, issues: walk.issues };
};
