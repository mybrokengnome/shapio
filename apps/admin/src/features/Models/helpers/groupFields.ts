import type { FieldGroup } from '@shapio/schema';

/**
 * Takes a field out of every group; a group it leaves empty is dropped. Its own module so both `draft.ts`
 * (`removeField`) and `groups.ts` use it without importing each other.
 */
export const withoutGroupField = (groups: readonly FieldGroup[], fieldId: string): FieldGroup[] =>
  groups.flatMap((group) => {
    if (!group.fieldIds.includes(fieldId)) {
      return [group];
    }
    const fieldIds = group.fieldIds.filter((id) => id !== fieldId);
    return fieldIds.length > 0 ? [{ ...group, fieldIds }] : [];
  });
