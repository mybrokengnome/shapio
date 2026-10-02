import { useNavigate, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import type { AppUsersSearch } from '@/app/searchSchemas';

/**
 * The search text and the current cursor live in the URL (bookmarkable, back-button friendly). Cursors of
 * earlier pages are kept in memory, since the API pages forward only (newest first).
 */
export const useAppUsersSearch = () => {
  const search = useSearch({ from: '/app/users/app' });
  const navigate = useNavigate({ from: '/users/app' });
  const [previousCursors, setPreviousCursors] = useState<(string | undefined)[]>([]);
  const go = (changes: Partial<AppUsersSearch>) =>
    void navigate({ search: (previous) => ({ ...previous, ...changes }) });
  return {
    search,
    goFirst:
      search.cursor === undefined
        ? undefined
        : () => {
            setPreviousCursors([]);
            go({ cursor: undefined });
          },
    goPrevious:
      previousCursors.length === 0
        ? undefined
        : () => {
            go({ cursor: previousCursors.at(-1) });
            setPreviousCursors((cursors) => cursors.slice(0, -1));
          },
    goNext: (nextCursor: string) => {
      setPreviousCursors((cursors) => [...cursors, search.cursor]);
      go({ cursor: nextCursor });
    },
    setQuery: (q: string | undefined) => {
      setPreviousCursors([]);
      go({ q, cursor: undefined });
    },
  };
};
