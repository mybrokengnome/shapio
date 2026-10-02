import type { PresencePerson } from '@shapio/client';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { adminApi } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import { PRESENCE_POLL_MS } from '../constants';

const NOBODY: ReadonlyMap<string, readonly PresencePerson[]> = new Map();

/**
 * Who is editing which entry of the model right now (`GET /api/admin/presence/:modelKey`), refreshed every
 * 15s while the tab is visible. Information only: entries lock nothing.
 */
export const useModelPresence = (modelKey: string) => {
  const presence = useQuery({
    queryKey: queryKeys.presence(modelKey),
    queryFn: () => adminApi.presence.model(modelKey),
    refetchInterval: PRESENCE_POLL_MS,
    retry: false,
    meta: { silent: true },
  });
  const byEntry = useMemo(
    () =>
      presence.data
        ? new Map(
            presence.data.entries.map((row) => [row.entryId, row.people.filter((person) => !person.you)]),
          )
        : NOBODY,
    [presence.data],
  );
  return { byEntry };
};
