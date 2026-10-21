import { createDefinitionIndex, type DefinitionIndex } from '@shapio/schema';
import { useMemo } from 'react';
import { useDefinitions } from '@/api/schema';

const EMPTY_INDEX = createDefinitionIndex([]);

/**
 * Inheritance lookups (`createDefinitionIndex`) over the active models and interfaces of this site, stored
 * as they are (own fields, `extends`, `implements`): parents, children, families, effective definitions,
 * and the interfaces a type implements. Empty while the models load; without interfaces until they do.
 */
export const useModelIndex = (): { index: DefinitionIndex } => {
  const { data } = useDefinitions('model');
  const { data: interfaces } = useDefinitions('interface');
  const index = useMemo(
    () =>
      data
        ? createDefinitionIndex([...data, ...(interfaces ?? [])].map(({ definition }) => definition))
        : EMPTY_INDEX,
    [data, interfaces],
  );
  return { index };
};
