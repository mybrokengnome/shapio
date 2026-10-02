import { useMemo } from 'react';
import { useDefinitions } from '@/api/schema';
import { usePrincipalUsage } from '@/api/usage';

/** Who reads what across every model, plus each model's API key for naming the fields. */
export const useReaders = (enabled: boolean) => {
  const models = useDefinitions('model');
  const modelIds = useMemo(() => (models.data ?? []).map(({ definition }) => definition.id), [models.data]);
  const usage = usePrincipalUsage(modelIds, enabled && models.isSuccess);
  const modelKeys = useMemo(
    () => new Map((models.data ?? []).map(({ definition }) => [definition.id, definition.apiKey])),
    [models.data],
  );
  return {
    ...usage,
    isPending: models.isPending || usage.isPending,
    error: models.error ?? usage.error,
    modelKeyOf: (modelId: string) => modelKeys.get(modelId) ?? modelId,
    servedReads: usage.principals.reduce((sum, principal) => sum + principal.requests, 0),
  };
};
