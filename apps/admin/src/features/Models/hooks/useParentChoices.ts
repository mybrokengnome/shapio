import type { DefinitionScope } from '@shapio/client';
import type { ModelDefinition } from '@shapio/schema';
import { useMemo } from 'react';
import { useDefinitions } from '@/api/schema';
import { parentChoices } from '../helpers/inheritance';
import { useModelIndex } from './useModelIndex';

/**
 * The collections a model may extend (see `parentChoices`): those in the given scope (shared, or the site
 * `siteId`), never the model itself or its descendants. `modelId` undefined for a model being created.
 */
export const useParentChoices = (
  scope: { scope: DefinitionScope; siteId: string | null },
  modelId?: string,
): { parentChoices: ModelDefinition[] } => {
  const { data } = useDefinitions('model');
  const { index } = useModelIndex();
  const { scope: where, siteId } = scope;
  const choices = useMemo(
    () => parentChoices(data ?? [], index, { scope: where, siteId }, modelId),
    [data, index, where, siteId, modelId],
  );
  return { parentChoices: choices };
};
