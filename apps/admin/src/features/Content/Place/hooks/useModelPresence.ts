import type { ModelPresence, PresencePerson } from '@shapio/client';
import { useQueries, type UseQueryResult } from '@tanstack/react-query';
import { adminApi } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import { PRESENCE_POLL_MS } from '../constants';

/** Everyone else editing, by entry. Module-level, so the combined result is kept while nothing changed. */
const combinePresence = (results: ReadonlyArray<UseQueryResult<ModelPresence>>) => ({
  byEntry: new Map<string, readonly PresencePerson[]>(
    results.flatMap((result) =>
      (result.data?.entries ?? []).map(
        (row) => [row.entryId, row.people.filter((person) => !person.you)] as const,
      ),
    ),
  ),
});

/**
 * Who is editing which entry of the models right now (`GET /api/admin/presence/:modelKey`, one request per
 * model: a type's list holds its kinds' entries, each edited under its own kind), refreshed every 15s while
 * the tab is visible. Information only: entries lock nothing.
 */
export const useModelPresence = (modelKeys: readonly string[]) =>
  useQueries({
    queries: modelKeys.map((modelKey) => ({
      queryKey: queryKeys.presence(modelKey),
      queryFn: () => adminApi.presence.model(modelKey),
      refetchInterval: PRESENCE_POLL_MS,
      retry: false,
      meta: { silent: true },
    })),
    combine: combinePresence,
  });
