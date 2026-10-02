import type { ModelKind } from '@shapio/schema';
import { isModelDefinition } from '@shapio/schema';
import { useMemo } from 'react';
import { useDefinitions } from '@/api/schema';

export type ModelSummary = { id: string; label: string; apiKey: string; kind: ModelKind; version: number };

/** Collections and singletons, by label, with their active version; `models` is undefined while loading. */
export const useModelSummaries = () => {
  const query = useDefinitions('model');
  const models = useMemo<ModelSummary[] | undefined>(
    () =>
      query.data
        ?.flatMap(({ definition, version }) =>
          isModelDefinition(definition)
            ? [
                {
                  id: definition.id,
                  label: definition.label,
                  apiKey: definition.apiKey,
                  kind: definition.kind,
                  version,
                },
              ]
            : [],
        )
        .sort((a, b) => a.label.localeCompare(b.label)),
    [query.data],
  );
  return { query, models };
};
