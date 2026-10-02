import { Clock } from 'lucide-react';
import { useMemo } from 'react';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { SEARCH_DEBOUNCE_MS, STATIC_RESULTS } from '../constants';
import { fuzzyFilter } from '../helpers/fuzzy';
import type { RecentItem } from '../helpers/recentItems';
import { usePaletteStore } from '../store';
import type { PaletteGroup, PaletteItem, RegisteredGroup } from '../types';
import { useEntrySearch } from './useEntrySearch';
import { useMediaSearch } from './useMediaSearch';

const REGISTERED_ORDER: readonly RegisteredGroup[] = ['page', 'create', 'goto'];

const toPaletteItem = (item: RecentItem): PaletteItem => ({
  id: `recent:${item.id}`,
  label: item.label,
  ...(item.hint ? { hint: item.hint } : {}),
  icon: Clock,
  link: item.link,
});

/**
 * What the palette lists for `query`. Empty: actions on this page, recent items, create and go-to. Typing:
 * the registered items it finds (fuzzy, best first), then entries and media from the server.
 */
export const usePaletteGroups = (query: string, recent: readonly RecentItem[]) => {
  const registrations = usePaletteStore((state) => state.registrations);
  const debounced = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
  const { items: entryItems, isFetching: entriesFetching } = useEntrySearch(debounced);
  const { items: mediaItems, isFetching: mediaFetching } = useMediaSearch(debounced);
  const groups = useMemo((): PaletteGroup[] => {
    const registered = new Map<RegisteredGroup, PaletteItem[]>();
    for (const { group, items } of registrations.values()) {
      registered.set(group, [...(registered.get(group) ?? []), ...items]);
    }
    const searching = query.trim() !== '';
    const fromRegistered = REGISTERED_ORDER.map((key) => {
      const items = registered.get(key) ?? [];
      return { key, items: searching ? fuzzyFilter(query, items).slice(0, STATIC_RESULTS) : items };
    });
    const [page, ...rest] = fromRegistered;
    const recentGroup: PaletteGroup = { key: 'recent', items: searching ? [] : recent.map(toPaletteItem) };
    // Server results only for the query they were fetched for, so stale rows never flash under new text.
    const current = debounced.trim() === query.trim();
    return [
      ...(page ? [page] : []),
      recentGroup,
      ...rest,
      { key: 'entries' as const, items: searching && current ? entryItems : [] },
      { key: 'media' as const, items: searching && current ? mediaItems : [] },
    ].filter((group) => group.items.length > 0);
  }, [registrations, query, debounced, recent, entryItems, mediaItems]);
  return { groups, isSearching: entriesFetching || mediaFetching || debounced.trim() !== query.trim() };
};
