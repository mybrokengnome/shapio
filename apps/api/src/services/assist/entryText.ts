import {
  effectiveTitleField,
  richTextToPlainText,
  type FieldDefinition,
  type RichTextDocument,
} from '@shapio/schema';
import { ASSIST_SUGGEST_SOURCE_CHARS, ASSIST_SUGGEST_VALUE_CHARS } from '../../constants/assist.js';
import { hidesPrivateComponentFields, maskAllows } from '../../content/compiler/policy.js';
import type { ContentModel } from '../../content/model.js';
import type { ContentData } from '../../db/contentData.js';
import type { FieldMask } from '../../permissions/types.js';

/** A rich-text value as plain text ('' for anything else). */
export const plainTextOf = (value: unknown): string =>
  typeof value === 'object' && value !== null && 'doc' in value
    ? richTextToPlainText(value as RichTextDocument)
    : '';

/** Leaves the field (by stable ID) out, with its component field when it is a component's field. */
export type SourceExclusion = { fieldId: string; componentFieldId?: string };

type Part = { kind: 'title' | 'property' | 'body'; label: string; text: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A string, text or enum value as text: enum values by their labels. */
const textOf = (field: FieldDefinition, value: unknown): string => {
  if (field.type === 'string' || field.type === 'text') {
    return typeof value === 'string' ? value : '';
  }
  if (field.type === 'enum') {
    const chosen = Array.isArray(value) ? value : [value];
    return field.settings.values
      .filter((option) => chosen.includes(option.value))
      .map((option) => option.label)
      .join(', ');
  }
  return field.type === 'richtext' ? plainTextOf(value) : '';
};

const partOf = (field: FieldDefinition, label: string, value: unknown, isTitle = false): Part[] => {
  const text = textOf(field, value).trim();
  if (text === '') {
    return [];
  }
  const kind = field.type === 'richtext' ? 'body' : isTitle ? 'title' : 'property';
  return [{ kind, label: isTitle ? 'Title' : label, text }];
};

/** A non-repeatable component's readable string, text, enum and rich-text fields. */
const componentParts = (
  model: ContentModel,
  holder: FieldDefinition,
  value: unknown,
  mask: FieldMask,
  exclude: SourceExclusion | undefined,
): Part[] => {
  if (holder.type !== 'component' || holder.settings.repeatable || !isRecord(value)) {
    return [];
  }
  const component = model.components.get(holder.settings.component)?.definition;
  const publicOnly = hidesPrivateComponentFields(mask);
  return (component?.fields ?? [])
    .filter((field) => !field.deprecated && !(publicOnly && field.public === false))
    .filter((field) => !(exclude?.fieldId === holder.id && exclude.componentFieldId === field.id))
    .flatMap((field) => partOf(field, `${holder.label} › ${field.label}`, value[field.id]));
};

/**
 * The text a suggestion is made from (plan write-and-fill §2): the entry's title, its string, text and enum
 * values (top level and in single components), then its rich text, as far as `mask` lets the caller read
 * them and within ASSIST_SUGGEST_SOURCE_CHARS (each property within ASSIST_SUGGEST_VALUE_CHARS). Repeatable
 * components, dynamic zones and other types are not read. '' when nothing readable holds text.
 */
export const entrySourceText = (
  model: ContentModel,
  data: Readonly<ContentData>,
  mask: FieldMask,
  exclude?: SourceExclusion,
): string => {
  const title = effectiveTitleField(model.definition);
  const parts = model.definition.fields
    .filter((field) => maskAllows(mask, field))
    .flatMap((field): Part[] => {
      if (field.type === 'component') {
        return componentParts(model, field, data[field.id], mask, exclude);
      }
      if (exclude?.fieldId === field.id && exclude.componentFieldId === undefined) {
        return [];
      }
      return partOf(field, field.label, data[field.id], field.id === title?.id);
    });
  const lines = [
    ...parts.filter((part) => part.kind === 'title'),
    ...parts.filter((part) => part.kind === 'property'),
  ].map((part) => `${part.label}: ${part.text.slice(0, ASSIST_SUGGEST_VALUE_CHARS)}`);
  let text = lines.join('\n');
  const body = parts
    .filter((part) => part.kind === 'body')
    .map((part) => part.text)
    .join('\n\n');
  if (body !== '') {
    text = `${text}${text === '' ? '' : '\n\n'}Body:\n${body}`;
  }
  return text.slice(0, ASSIST_SUGGEST_SOURCE_CHARS);
};
