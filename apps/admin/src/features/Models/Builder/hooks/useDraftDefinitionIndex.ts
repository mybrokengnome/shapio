import { createDefinitionIndex, type DefinitionIndex, type SchemaDefinition } from '@shapio/schema';
import { useMemo } from 'react';
import { useAllDefinitions } from '@/api/schema';

/**
 * Every definition of this site's view (models, components, interfaces) with the builder's draft in place of
 * its saved version, as an index: what the field list and the Target select name targets from, so a draft's
 * relation to itself, or to a kind it just gained, reads right before it ships.
 */
export const useDraftDefinitionIndex = (
  draft: SchemaDefinition | null | undefined,
): { index: DefinitionIndex; definitions: readonly SchemaDefinition[] } => {
  const { definitions: items } = useAllDefinitions();
  return useMemo(() => {
    const saved = (items ?? []).map(({ definition }) => definition);
    const definitions = draft ? [...saved.filter((entry) => entry.id !== draft.id), draft] : saved;
    return { index: createDefinitionIndex(definitions), definitions };
  }, [items, draft]);
};
