import type { AuditQuery } from '@shapio/client';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { adminApi } from './client';
import { queryKeys } from './queryKeys';

export const useAuditEvents = (query: AuditQuery) =>
  useQuery({
    queryKey: queryKeys.audit.list(query),
    queryFn: () => adminApi.audit.list(query),
    placeholderData: keepPreviousData,
    meta: { silent: true },
  });
