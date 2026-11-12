import type { FieldDefinition } from '@shapio/schema';
import type { ContentData } from '../../db/contentData.js';
import { AppError } from '../../helpers/appError.js';
import type { ComponentLookup } from '../itemIds.js';
import { COMPONENT_KEY, isMissingValue } from '../validator/index.js';
import { pointer } from '../validator/issues.js';

/**
 * A delivery caller writes only the component fields its audience can read (public ones, never deprecated
 * ones): one it sends anyway (a value, or a null that would clear it) is refused like a top-level field its role may not change (403
 * `FORBIDDEN_FIELD`), named by its JSON pointer (`/cards/0/note`). Before 0.9.0 such a value was written.
 */
export const forbiddenComponentFields = (message: string, fields: readonly string[]) =>
  new AppError(403, 'FORBIDDEN_FIELD', message, { fields: [...fields] });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** JSON pointers (today's API IDs) of the component fields `patch` sets that `writable` refuses. */
export const unwritableComponentFields = (
  patch: Readonly<ContentData>,
  fields: readonly FieldDefinition[],
  componentOf: ComponentLookup,
  writable: (field: FieldDefinition) => boolean,
): string[] => {
  const denied: string[] = [];
  const instance = (fieldsOf: readonly FieldDefinition[], item: unknown, path: string) => {
    if (!isRecord(item)) {
      return;
    }
    for (const field of fieldsOf) {
      const value = item[field.id];
      if (value === undefined) {
        continue;
      }
      // Sent at all (an explicit null too: that would clear it).
      if (!writable(field)) {
        denied.push(pointer(path, field.apiKey));
        continue;
      }
      if (!isMissingValue(value)) {
        walkValue(field, value, pointer(path, field.apiKey));
      }
    }
  };
  const walkValue = (field: FieldDefinition, value: unknown, path: string) => {
    if (field.type === 'component') {
      const component = componentOf(field.settings.component);
      if (Array.isArray(value)) {
        value.forEach((item: unknown, index) =>
          instance(component?.fields ?? [], item, pointer(path, index)),
        );
      } else {
        instance(component?.fields ?? [], value, path);
      }
    } else if (field.type === 'dynamiczone' && Array.isArray(value)) {
      value.forEach((item: unknown, index) => {
        const kind =
          isRecord(item) && typeof item[COMPONENT_KEY] === 'string' ? item[COMPONENT_KEY] : undefined;
        instance((kind ? componentOf(kind)?.fields : undefined) ?? [], item, pointer(path, index));
      });
    }
  };
  for (const field of fields) {
    if (field.id in patch) {
      walkValue(field, patch[field.id], pointer('', field.apiKey));
    }
  }
  return denied;
};

/** Refuses a value for a component field the caller may not write (see above). */
export const assertComponentFieldsWritable = (
  patch: Readonly<ContentData>,
  fields: readonly FieldDefinition[],
  componentOf: ComponentLookup,
  writable: (field: FieldDefinition) => boolean,
): void => {
  const denied = unwritableComponentFields(patch, fields, componentOf, writable);
  if (denied.length > 0) {
    throw forbiddenComponentFields('Your role may not change some of these fields', denied);
  }
};
