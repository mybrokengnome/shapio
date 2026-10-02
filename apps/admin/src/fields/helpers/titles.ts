import type { AdminEntryListItem } from '@shapio/client';
import {
  effectiveTitleField,
  TEXT_TITLE_FIELD_TYPES,
  type FieldDefinition,
  type ModelDefinition,
} from '@shapio/schema';

/**
 * The field that labels a model's entries in lists, pickers and relation summaries: the configured title
 * field, or the first text field when none is set (the same rule the API's `q` search uses).
 */
export const titleFieldOf = (model: ModelDefinition): FieldDefinition | undefined =>
  effectiveTitleField(model);

/** Whether the list API's `q` search works for this model (it searches the title field, if it is text). */
export const isSearchable = (model: ModelDefinition): boolean => {
  const title = titleFieldOf(model);
  return title !== undefined && TEXT_TITLE_FIELD_TYPES.has(title.type);
};

/** An entry's label: its title field's text, or undefined (callers show "Untitled"). */
export const entryTitle = (
  model: ModelDefinition,
  data: Readonly<Record<string, unknown>>,
): string | undefined => {
  const title = titleFieldOf(model);
  const value = title ? data[title.apiKey] : undefined;
  return typeof value === 'string' && value.trim() !== ''
    ? value
    : typeof value === 'number'
      ? String(value)
      : undefined;
};

export const shortId = (id: string) => id.slice(0, 8);

export const labelOf = (
  model: ModelDefinition,
  item: Pick<AdminEntryListItem, 'id' | 'data'>,
  untitled: string,
) => entryTitle(model, item.data) ?? `${untitled} · ${shortId(item.id)}`;
