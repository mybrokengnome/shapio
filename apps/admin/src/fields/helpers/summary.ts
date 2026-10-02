import type { ComponentDefinition, FieldDefinition } from '@shapio/schema';
import { isEmptyValue, isRecord, toList } from './values';

/**
 * A short, readable summary of a value for collapsed component items, dynamic-zone outlines, list cells
 * and revision diffs. Plain text only; never markup from the content.
 */
const MAX_SUMMARY = 80;

const truncate = (text: string) => (text.length > MAX_SUMMARY ? `${text.slice(0, MAX_SUMMARY - 1)}…` : text);

const richTextPlain = (node: unknown): string => {
  if (!isRecord(node)) {
    return '';
  }
  if (typeof node.text === 'string') {
    return node.text;
  }
  const children = Array.isArray(node.content) ? node.content : [];
  return children.map(richTextPlain).join(node.type === 'doc' ? ' ' : '');
};

export const summarizeValue = (field: FieldDefinition, value: unknown): string => {
  if (isEmptyValue(value)) {
    return '';
  }
  switch (field.type) {
    case 'richtext':
      return truncate(isRecord(value) ? richTextPlain(value.doc).trim() : '');
    case 'boolean':
      return value === true ? '✓' : '✗';
    case 'enum':
      return toList<string>(value)
        .map((item) => field.settings.values.find((option) => option.value === item)?.label ?? item)
        .join(', ');
    case 'json':
      return truncate(JSON.stringify(value));
    case 'media':
    case 'relation':
    case 'component':
    case 'dynamiczone':
      return String(toList(value).length);
    default:
      return truncate(String(value));
  }
};

const TEXTUAL_TYPES: ReadonlySet<string> = new Set(['string', 'text', 'slug', 'email', 'url', 'uid', 'enum']);

/** A component item's label: its title field's value, else the first non-empty text field. */
export const summarizeItem = (component: ComponentDefinition, item: unknown): string => {
  if (!isRecord(item)) {
    return '';
  }
  const titleField = component.fields.find((field) => field.id === component.display.titleFieldId);
  const candidates = titleField ? [titleField, ...component.fields] : component.fields;
  for (const field of candidates) {
    if (TEXTUAL_TYPES.has(field.type) || field.type === 'richtext') {
      const summary = summarizeValue(field, item[field.apiKey]);
      if (summary) {
        return summary;
      }
    }
  }
  return '';
};
