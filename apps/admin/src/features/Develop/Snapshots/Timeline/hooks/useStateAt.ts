import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { snapshotPlaceQueryOptions, useSnapshotChanges } from '@/api/snapshots';
import { buildCards, type LiveItem, type TimelineCard } from '../helpers/cards';
import type { PlaceWithLocales } from './useTimelinePlaces';

type CoverValue = { url?: unknown; variants?: Array<{ name?: unknown; url?: unknown }> };

/** The cover's thumbnail variant when it has one, else its file URL. */
const coverUrlOf = (value: unknown): string | null => {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const cover = value as CoverValue;
  const thumbnail = cover.variants?.find((variant) => variant.name === 'thumbnail')?.url;
  if (typeof thumbnail === 'string') {
    return thumbnail;
  }
  return typeof cover.url === 'string' ? cover.url : null;
};

const liveItemOf = (place: PlaceWithLocales, item: Record<string, unknown>): LiveItem => {
  const title = place.titleKey ? item[place.titleKey] : undefined;
  return {
    id: String(item.id),
    locale: String(item.locale),
    title:
      typeof title === 'string' && title.trim() !== ''
        ? title
        : typeof title === 'number'
          ? String(title)
          : null,
    coverUrl: place.coverKey ? coverUrlOf(item[place.coverKey]) : null,
  };
};

export type PlaceState = { place: PlaceWithLocales; cards: TimelineCard[] };

const readsOf = (seq: number, places: readonly PlaceWithLocales[]) =>
  places.flatMap((place) => place.locales.map((locale) => ({ place, locale, seq })));

/**
 * The content system at snapshot `seq`: each place's live entries (read through delivery, per locale),
 * marked against `previous` with the snapshot diff. The neighbours are prefetched so dragging is smooth;
 * every read is cached per snapshot (a snapshot never changes).
 */
export const useStateAt = (
  seq: number,
  previous: number | undefined,
  neighbours: readonly number[],
  places: readonly PlaceWithLocales[],
) => {
  const queryClient = useQueryClient();
  const reads = readsOf(seq, places);
  const changes = useSnapshotChanges(previous ?? 0, seq, previous !== undefined);
  const live = useQueries({
    queries: reads.map(({ place, locale }) => snapshotPlaceQueryOptions(seq, place, locale)),
    combine: (results) => ({
      data: results.map((result) => result.data),
      isPending: results.some((result) => result.isPending),
      error: results.find((result) => result.error)?.error ?? null,
      refetch: () => Promise.all(results.map((result) => result.refetch())),
    }),
  });

  useEffect(() => {
    for (const neighbour of neighbours) {
      for (const read of readsOf(neighbour, places)) {
        void queryClient.prefetchQuery(snapshotPlaceQueryOptions(neighbour, read.place, read.locale));
      }
    }
  }, [neighbours, places, queryClient]);

  const diff = changes.data?.items ?? [];
  const states: PlaceState[] = places.map((place) => {
    const items = reads.flatMap((read, index) =>
      read.place === place ? (live.data[index] ?? []).map((item) => liveItemOf(place, item)) : [],
    );
    return {
      place,
      cards: buildCards(
        items,
        diff.filter((change) => change.modelId === place.modelId),
      ),
    };
  });
  return {
    states: states.filter((state) => state.cards.length > 0),
    isPending: live.isPending || (previous !== undefined && changes.isPending),
    error: live.error ?? changes.error,
    refetch: () => Promise.all([live.refetch(), changes.refetch()]),
  };
};
