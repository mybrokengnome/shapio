import { useQuery } from '@tanstack/react-query';
import { linkOptions } from '@tanstack/react-router';
import { Image } from 'lucide-react';
import { useMemo } from 'react';
import { useHasGlobalPermission } from '@/api/auth';
import { adminApi } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import { MEDIA_RESULTS, MIN_SEARCH_LENGTH } from '../constants';
import type { PaletteItem } from '../types';

/** Library files whose name or text matches `query` (already debounced), when the admin may read media. */
export const useMediaSearch = (query: string): { items: PaletteItem[]; isFetching: boolean } => {
  const canRead = useHasGlobalPermission('media.read');
  const search = query.trim();
  const enabled = canRead && search.length >= MIN_SEARCH_LENGTH;
  const result = useQuery({
    queryKey: [...queryKeys.media.assets({ search }), 'palette'],
    queryFn: () => adminApi.media.assets.list({ search, limit: MEDIA_RESULTS }),
    enabled,
    meta: { silent: true },
  });
  const items = useMemo(
    () =>
      enabled
        ? (result.data?.items ?? []).map((asset): PaletteItem => ({
            id: `media:${asset.id}`,
            label: asset.filename,
            ...(asset.alt ? { keywords: [asset.alt] } : {}),
            icon: Image,
            link: linkOptions({ to: '/media', search: { asset: asset.id } }),
          }))
        : [],
    [enabled, result.data],
  );
  return { items, isFetching: enabled && result.isFetching };
};
