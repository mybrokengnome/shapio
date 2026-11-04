import type { ModelDefinition } from '@shapio/schema';
import { useMemo } from 'react';
import { useDefinitions } from '@/api/schema';

/** The site's content types by API ID (labels and kinds for rows that name a model by its key). */
export const useModelsByKey = (): ReadonlyMap<string, ModelDefinition> => {
  const { data } = useDefinitions('model');
  return useMemo(
    () =>
      new Map(
        (data ?? []).map(({ definition }) => [definition.apiKey, definition as ModelDefinition] as const),
      ),
    [data],
  );
};
