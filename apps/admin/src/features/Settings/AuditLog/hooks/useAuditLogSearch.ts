import { useNavigate, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import type { AuditSearch } from '@/app/searchSchemas';

/**
 * Filters and the current cursor live in the URL (bookmarkable, back-button friendly). The cursors of the
 * pages before this one are kept in memory, since the API pages forward only (newest first).
 */
export const useAuditLogSearch = () => {
  const search = useSearch({ from: '/app/network/audit-log' });
  const navigate = useNavigate({ from: '/network/audit-log' });
  const [previousCursors, setPreviousCursors] = useState<(string | undefined)[]>([]);
  const go = (changes: Partial<AuditSearch>) =>
    void navigate({ search: (previous) => ({ ...previous, ...changes }) });
  const atFirst = search.cursor === undefined;
  return {
    search,
    goFirst: atFirst
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
    setFilters: (filters: Pick<AuditSearch, 'action' | 'actorType'>) => {
      setPreviousCursors([]);
      go({ ...filters, cursor: undefined });
    },
  };
};
