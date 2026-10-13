import { useCallback } from 'react';
import { useModelIndex } from './useModelIndex';

/**
 * A model's name by stable ID from the definitions cache, for sentences that name other models (a parent in
 * "Move this from Products to Media"). Undefined for an ID the cache doesn't know.
 */
export const useDefinitionName = (): { definitionName: (id: string) => string | undefined } => {
  const { index } = useModelIndex();
  const definitionName = useCallback((id: string) => index.get(id)?.label, [index]);
  return { definitionName };
};
