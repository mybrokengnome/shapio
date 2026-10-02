import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import { USAGE_DAYS } from '@/api/usage';

/**
 * Who read a model's fields (`GET /api/admin/usage/fields`), on the same cache entry the Live page uses.
 * Needs `tokens.manage`; without it the query fails quietly and the shape shows no readers.
 */
export const useFieldUsage = (modelId: string) =>
  useQuery({
    queryKey: queryKeys.develop.usage.model(modelId, USAGE_DAYS),
    queryFn: () => adminApi.usage.fields({ modelId, days: USAGE_DAYS }),
    meta: { silent: true },
  });
