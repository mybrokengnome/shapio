import { createDefinitionIndex, type DefinitionIndex } from '@shapio/schema';
import { useMemo } from 'react';
import { useDefinitions } from '@/api/schema';

const EMPTY_INDEX = createDefinitionIndex([]);

/**
 * Inheritance lookups (`createDefinitionIndex`) over the active models of this site, stored as they are
 * (own fields, `extends`): parents, children, families and effective definitions. Empty while loading.
 */
export const useModelIndex = (): { index: DefinitionIndex } => {
  const { data } = useDefinitions('model');
  const index = useMemo(
    () => (data ? createDefinitionIndex(data.map(({ definition }) => definition)) : EMPTY_INDEX),
    [data],
  );
  return { index };
};
