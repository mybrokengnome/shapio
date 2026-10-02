import { useNavigate, useSearch } from '@tanstack/react-router';
import type { MediaSearch } from '@/app/searchSchemas';
import { MIME_FILTER_BY_TYPE } from '../constants';

/** Folder, filters, view and the open asset live in the URL (bookmarkable, back-button friendly). */
export const useMediaSearch = () => {
  const search = useSearch({ from: '/app/media' });
  const navigate = useNavigate({ from: '/media' });
  const setSearch = (changes: Partial<MediaSearch>, replace = false) =>
    void navigate({ search: (previous) => ({ ...previous, ...changes }), replace });
  return {
    search,
    setSearch,
    /** The API query for the current folder and filters. */
    assetQuery: {
      ...(search.folder ? { folder: search.folder } : {}),
      ...(search.q ? { search: search.q } : {}),
      ...(search.type ? { mimeType: MIME_FILTER_BY_TYPE[search.type] } : {}),
    },
  };
};
