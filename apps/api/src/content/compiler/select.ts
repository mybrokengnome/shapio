import {
  renderRichTextHtml,
  type ComponentDefinition,
  type FieldDefinition,
  type RichTextDocument,
} from '@shapio/schema';
import type { FieldMask } from '../../permissions/types.js';
import type { ContentModel } from '../model.js';
import { COMPONENT_KEY } from '../validator/index.js';
import { maskAllows } from './policy.js';

/**
 * Storage → API projection with explicit masks (build plan §3.10: generic content routes cannot carry
 * fixed response schemas, so this is where leaks are prevented). Only fields the mask allows, and the
 * caller selected, are emitted; field IDs become API keys; relation IDs are limited to targets the caller
 * may see (published, readable) unless they were populated. Absent values are emitted as null (or [] for
 * lists) so every entry of a model has the same shape.
 */

/** The top-level fields a response carries: readable, live (unless named by the mask) and selected. */
export const selectFields = (
  model: ContentModel,
  mask: FieldMask,
  selected: readonly FieldDefinition[] | null,
): FieldDefinition[] => {
  const allowed = model.definition.fields.filter((field) => maskAllows(mask, field));
  return selected ? allowed.filter((field) => selected.some((choice) => choice.id === field.id)) : allowed;
};

export type ProjectionOptions = {
  model: ContentModel;
  fields: readonly FieldDefinition[];
  /** Relation targets the caller may see; null shows every ID (admin reads). */
  visibleTargets: ReadonlySet<string> | null;
  /** Expanded targets: relation field ID → target entry ID → projected entry. */
  populated: ReadonlyMap<string, ReadonlyMap<string, unknown>>;
  /** Add sanitized HTML next to rich-text JSON (delivery). */
  richTextHtml: boolean;
  /** Asset views by ID (media fields become views, missing assets are dropped); null leaves IDs as stored. */
  mediaAssets: ReadonlyMap<string, { url: string }> | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isListField = (field: FieldDefinition) =>
  (field.type === 'relation' && field.settings.cardinality === 'many') ||
  (field.type === 'media' && field.settings.multiple) ||
  (field.type === 'component' && field.settings.repeatable) ||
  field.type === 'dynamiczone';

const projectRelation = (
  field: FieldDefinition & { type: 'relation' },
  value: unknown,
  options: ProjectionOptions,
  topLevel: boolean,
) => {
  const ids = (Array.isArray(value) ? value : [value]).filter((id): id is string => typeof id === 'string');
  const populated = topLevel ? options.populated.get(field.id) : undefined;
  const shown = ids.flatMap((id) => {
    if (populated) {
      return populated.has(id) ? [populated.get(id)] : [];
    }
    return options.visibleTargets === null || options.visibleTargets.has(id) ? [id] : [];
  });
  return field.settings.cardinality === 'many' ? shown : (shown[0] ?? null);
};

const projectComponent = (
  component: ComponentDefinition | undefined,
  value: unknown,
  options: ProjectionOptions,
): Record<string, unknown> | null =>
  component && isRecord(value)
    ? projectFields(
        component.fields.filter((field) => !field.deprecated),
        value,
        options,
        false,
      )
    : null;

const isStringOrStrings = (value: unknown) =>
  typeof value === 'string' || (Array.isArray(value) && value.every((item) => typeof item === 'string'));

/**
 * Whether a stored value has the shape the field's current type produces. Old snapshots are served through
 * the current schema (plan developer-face §5): a value written before a type change (text → rich text) is
 * not converted at read time, it is emitted as empty instead of being passed off as the new type.
 */
const matchesFieldType = (field: FieldDefinition, value: unknown): boolean => {
  switch (field.type) {
    case 'number':
    case 'integer':
      return typeof value === 'number';
    case 'boolean':
      return typeof value === 'boolean';
    case 'json':
      return true;
    case 'richtext':
      return isRecord(value) && isRecord(value.doc);
    case 'relation':
    case 'media':
      return isStringOrStrings(value);
    case 'enum':
      return field.settings.multiple
        ? Array.isArray(value) && value.every((item) => typeof item === 'string')
        : typeof value === 'string';
    case 'component':
      return field.settings.repeatable ? Array.isArray(value) : isRecord(value);
    case 'dynamiczone':
      return Array.isArray(value);
    default:
      // string, text, slug, email, url, uid, date, datetime, time, decimal, biginteger
      return typeof value === 'string';
  }
};

const projectValue = (
  field: FieldDefinition,
  value: unknown,
  options: ProjectionOptions,
  topLevel: boolean,
): unknown => {
  if (value === undefined || value === null || !matchesFieldType(field, value)) {
    return isListField(field) ? [] : null;
  }
  switch (field.type) {
    case 'relation':
      return projectRelation(field, value, options, topLevel);
    case 'component': {
      const component = options.model.components.get(field.settings.component)?.definition;
      return field.settings.repeatable
        ? (Array.isArray(value) ? value : []).map((item) => projectComponent(component, item, options))
        : projectComponent(component, value, options);
    }
    case 'dynamiczone':
      return (Array.isArray(value) ? value : []).flatMap((item) => {
        const component = isRecord(item)
          ? options.model.components.get(String(item[COMPONENT_KEY]))?.definition
          : undefined;
        const projected = projectComponent(component, item, options);
        return component && projected ? [{ [COMPONENT_KEY]: component.apiKey, ...projected }] : [];
      });
    case 'richtext':
      return options.richTextHtml
        ? {
            ...(value as RichTextDocument),
            html: renderRichTextHtml(value as RichTextDocument, (id) => options.mediaAssets?.get(id)?.url),
          }
        : value;
    case 'media': {
      if (!options.mediaAssets) {
        return value;
      }
      const assets = (Array.isArray(value) ? value : [value]).flatMap((id) => {
        const asset = typeof id === 'string' ? options.mediaAssets?.get(id) : undefined;
        return asset ? [asset] : [];
      });
      return field.settings.multiple ? assets : (assets[0] ?? null);
    }
    default:
      return value;
  }
};

function projectFields(
  fields: readonly FieldDefinition[],
  data: Readonly<Record<string, unknown>>,
  options: ProjectionOptions,
  topLevel: boolean,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const field of fields) {
    output[field.apiKey] = projectValue(field, data[field.id], options, topLevel);
  }
  return output;
}

/** A head's data as the API returns it. */
export const projectData = (data: Readonly<Record<string, unknown>>, options: ProjectionOptions) =>
  projectFields(options.fields, data, options, true);
