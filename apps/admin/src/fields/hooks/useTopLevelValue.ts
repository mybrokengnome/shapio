import type { FieldDefinition } from '@shapio/schema';
import { useCallback } from 'react';
import { useEntryForm } from '../form/context';

/** One top-level field's value and setter: subscribes to that value only, so typing re-renders one field. */
export const useTopLevelValue = (field: FieldDefinition) => {
  const value = useEntryForm((state) => state.values[field.apiKey]);
  const setValue = useEntryForm((state) => state.setValue);
  const onChange = useCallback((next: unknown) => setValue(field.apiKey, next), [setValue, field.apiKey]);
  return { value, onChange };
};
