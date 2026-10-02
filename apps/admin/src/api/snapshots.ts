import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi, apiClient } from './client';
import { withCsrf } from './csrf';
import { isNotFound } from './errors';
import { queryKeys } from './queryKeys';

const silent = { silent: true } as const;

export const SNAPSHOT_PAGE_SIZE = 25;
/** Entries shown per diff (the first page); the summary says when there are more. */
export const SNAPSHOT_DIFF_LIMIT = 200;

export const useSnapshots = (cursor: string | undefined) =>
  useQuery({
    queryKey: queryKeys.develop.snapshots.list(cursor),
    queryFn: () => adminApi.snapshots.list({ cursor, limit: SNAPSHOT_PAGE_SIZE }),
    placeholderData: keepPreviousData,
    meta: silent,
  });

export const useSnapshot = (seq: number) =>
  useQuery({
    queryKey: queryKeys.develop.snapshots.snapshot(seq),
    queryFn: () => adminApi.snapshots.get(seq),
    meta: silent,
  });

/**
 * Live content that differs between `from` and `to` (`from < to`), from the snapshot diff API. It is a
 * delivery route; the admin session reads it as an admin, so every model is included.
 */
export const useSnapshotChanges = (from: number, to: number, enabled = true) =>
  useQuery({
    queryKey: queryKeys.develop.snapshots.changes(from, to),
    queryFn: () => apiClient.snapshots.changes({ from, to, limit: SNAPSHOT_DIFF_LIMIT }),
    enabled: enabled && from >= 0 && from < to,
    placeholderData: keepPreviousData,
    meta: silent,
  });

/** Creates an open restore change set (nothing goes live until it ships). */
export const useRestoreSnapshot = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['snapshots', 'restore'],
    meta: silent,
    mutationFn: (seq: number) => withCsrf(() => adminApi.snapshots.restore(seq)),
    onSuccess: (set) => {
      queryClient.setQueryData(queryKeys.develop.changeSets.set(set.id), set);
      return queryClient.invalidateQueries({ queryKey: queryKeys.develop.changeSets.all });
    },
  });
};

/** The ledger's pages read at once (at most 10 × 200 snapshots), for the timeline's slider. */
const LEDGER_PAGE = 200;
const LEDGER_MAX_PAGES = 10;

/** Every snapshot in the ledger, newest first (the first 2,000), plus the current number. */
export const useSnapshotLedger = () =>
  useQuery({
    queryKey: queryKeys.develop.snapshots.ledger,
    queryFn: async () => {
      let page = await adminApi.snapshots.list({ limit: LEDGER_PAGE });
      const items = [...page.items];
      for (let read = 1; page.nextCursor && read < LEDGER_MAX_PAGES; read += 1) {
        page = await adminApi.snapshots.list({ cursor: page.nextCursor, limit: LEDGER_PAGE });
        items.push(...page.items);
      }
      return { items, current: page.current };
    },
    meta: silent,
  });

/** A place as the timeline reads it through delivery: its route, and the fields a card shows. */
export type TimelinePlace = {
  modelId: string;
  modelKey: string;
  routeKey: string;
  label: string;
  singleton: boolean;
  titleKey: string | null;
  coverKey: string | null;
};

type DeliveryItem = Record<string, unknown> & { id: string; locale: string };

/** Entries a place card grid shows per snapshot (delivery's page size). */
export const TIMELINE_PAGE_SIZE = 50;

/**
 * One place as delivery served it at snapshot `seq` in `locale` (the admin session reads every model).
 * Singletons answer with one entry, collections with a page of them.
 */
export const snapshotPlaceQueryOptions = (seq: number, place: TimelinePlace, locale: string) => ({
  queryKey: queryKeys.develop.snapshots.place(seq, place.routeKey, locale),
  queryFn: async (): Promise<DeliveryItem[]> => {
    const fields = [place.titleKey, place.coverKey].filter((key): key is string => key !== null);
    const params = new URLSearchParams({ snapshot: String(seq), locale });
    if (!place.singleton) {
      params.set('pageSize', String(TIMELINE_PAGE_SIZE));
    }
    if (fields.length > 0) {
      params.set('fields', fields.join(','));
    }
    try {
      const body = await apiClient.request<{ data: DeliveryItem[] | DeliveryItem | null }>(
        `/api/content/${encodeURIComponent(place.routeKey)}?${params.toString()}`,
      );
      return Array.isArray(body.data) ? body.data : body.data ? [body.data] : [];
    } catch (error) {
      // A singleton that wasn't published yet at that snapshot.
      if (place.singleton && isNotFound(error)) {
        return [];
      }
      throw error;
    }
  },
  staleTime: Infinity,
  meta: silent,
});
