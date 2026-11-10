import type { ComponentDefinition, FieldDefinition } from '@shapio/schema';
import type { ContentData } from '../../db/contentData.js';
import { COMPONENT_KEY, isMissingValue } from '../validator/index.js';

/**
 * A component instance is written whole, so a delivery caller that cannot read one of its fields (private to
 * its audience, or deprecated) would wipe that field's stored value just by sending back what it read. Such
 * fields are carried over from the stored instance instead, never cleared by omission: repeatable items and
 * dynamic-zone items matched by position, a zone item only when it holds the same component. Nested
 * components follow the same rule. Admin writes never need it (admins read everything).
 */
export type ComponentLookup = (componentId: string) => ComponentDefinition | undefined;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const keepInInstance = (
  component: ComponentDefinition | undefined,
  written: unknown,
  stored: unknown,
  componentOf: ComponentLookup,
  readable: (field: FieldDefinition) => boolean,
): unknown => {
  if (!component || !isRecord(written) || !isRecord(stored)) {
    return written;
  }
  const output: Record<string, unknown> = { ...written };
  for (const field of component.fields) {
    if (!readable(field) && isMissingValue(output[field.id]) && !isMissingValue(stored[field.id])) {
      output[field.id] = stored[field.id];
    } else if (field.id in output) {
      // Into nested instances too: one sent (or carried) in part keeps what is unreadable inside it.
      output[field.id] = keepInValue(field, output[field.id], stored[field.id], componentOf, readable);
    }
  }
  return output;
};

const at = (value: unknown, index: number): unknown => (Array.isArray(value) ? value[index] : undefined);

const keepInValue = (
  field: FieldDefinition,
  written: unknown,
  stored: unknown,
  componentOf: ComponentLookup,
  readable: (field: FieldDefinition) => boolean,
): unknown => {
  if (field.type === 'component') {
    const component = componentOf(field.settings.component);
    return Array.isArray(written)
      ? written.map((item, index) =>
          keepInInstance(component, item, at(stored, index), componentOf, readable),
        )
      : keepInInstance(component, written, stored, componentOf, readable);
  }
  if (field.type === 'dynamiczone' && Array.isArray(written)) {
    return written.map((item: unknown, index) => {
      const storedItem = at(stored, index);
      const componentId = isRecord(item) ? item[COMPONENT_KEY] : undefined;
      if (
        typeof componentId !== 'string' ||
        !isRecord(storedItem) ||
        storedItem[COMPONENT_KEY] !== componentId
      ) {
        return item;
      }
      return keepInInstance(componentOf(componentId), item, storedItem, componentOf, readable);
    });
  }
  return written;
};

/**
 * `patch` (field IDs, storage form) with every component field the caller cannot read carried over from
 * `before` (the draft the write starts from), at any depth. Top-level fields are untouched: a patch only
 * changes the fields it names.
 */
export const keepUnreadableComponentFields = (
  patch: Readonly<ContentData>,
  before: Readonly<ContentData>,
  fields: readonly FieldDefinition[],
  componentOf: ComponentLookup,
  readable: (field: FieldDefinition) => boolean,
): ContentData => {
  const output: ContentData = { ...patch };
  for (const field of fields) {
    if (field.id in output && (field.type === 'component' || field.type === 'dynamiczone')) {
      output[field.id] = keepInValue(field, output[field.id], before[field.id], componentOf, readable);
    }
  }
  return output;
};
