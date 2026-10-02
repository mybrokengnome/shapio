import { RICHTEXT_FORMAT, type DataType, type SchemaChange } from '@shapio/schema';
import { plainTextToRichText, richTextToPlainText } from '../richtext/render.js';
import type { RichTextDocument } from '../richtext/validate.js';

/**
 * Value conversions for `convert` prerequisites (brief §5: "type or rich-text format conversion"). Every
 * conversion is idempotent (a value already in the target form is left alone), because the planner's
 * delta re-check may convert a head that the scan already converted.
 */
export type Conversion =
  { kind: 'keep' } | { kind: 'set'; value: unknown } | { kind: 'clear' } | { kind: 'fail'; reason: string };

const KEEP: Conversion = { kind: 'keep' };
const set = (value: unknown): Conversion => ({ kind: 'set', value });

const isRichText = (value: unknown): value is RichTextDocument =>
  typeof value === 'object' && value !== null && (value as { format?: unknown }).format === RICHTEXT_FORMAT;

const NUMBER_TYPES: ReadonlySet<DataType> = new Set(['number', 'integer']);
const NUMERIC_STRING_TYPES: ReadonlySet<DataType> = new Set(['decimal', 'biginteger']);
const TEXT_TYPES: ReadonlySet<DataType> = new Set(['string', 'text']);

const convertType = (to: DataType, value: unknown): Conversion => {
  if (NUMERIC_STRING_TYPES.has(to)) {
    return typeof value === 'number' ? set(String(value)) : KEEP;
  }
  if (NUMBER_TYPES.has(to)) {
    return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))
      ? set(Number(value))
      : KEEP;
  }
  if (TEXT_TYPES.has(to)) {
    if (isRichText(value)) {
      return set(richTextToPlainText(value));
    }
    return typeof value === 'number' || typeof value === 'boolean' ? set(String(value)) : KEEP;
  }
  if (to === 'richtext') {
    return typeof value === 'string' ? set(plainTextToRichText(value)) : KEEP;
  }
  return KEEP;
};

const convertCardinality = (toSingle: boolean, value: unknown): Conversion => {
  if (toSingle) {
    if (!Array.isArray(value)) {
      return KEEP;
    }
    return value.length > 0 ? set(value[0]) : { kind: 'clear' };
  }
  return Array.isArray(value) ? KEEP : set([value]);
};

/** The conversion a field change needs for one stored value (present, non-null). */
export const convertValue = (change: SchemaChange, value: unknown): Conversion => {
  if (change.kind === 'field.type') {
    return convertType(change.to as DataType, value);
  }
  if (change.kind !== 'field.settings') {
    return KEEP;
  }
  switch (change.property) {
    case 'multiple':
    case 'repeatable':
    case 'cardinality':
      return convertCardinality(change.to === false || change.to === 'one', value);
    case 'target':
    case 'component':
      // Values point at entries (or hold instances) of the old target: they cannot carry over.
      return { kind: 'clear' };
    case 'formatVersion':
      return isRichText(value) && value.version !== change.to
        ? {
            kind: 'fail',
            reason: `no converter from rich-text format version ${String(value.version)} to ${JSON.stringify(change.to)}`,
          }
        : KEEP;
    default:
      return KEEP;
  }
};

/** Changes converted per entry across locales or states instead of per value. */
export const isEntryLevelConversion = (change: SchemaChange) =>
  change.kind === 'field.localized' ||
  change.kind === 'model.localized' ||
  change.kind === 'model.draftAndPublish';
