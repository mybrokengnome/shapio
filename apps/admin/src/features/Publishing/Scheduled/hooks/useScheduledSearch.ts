import { useNavigate, useSearch } from '@tanstack/react-router';
import type { SchedulesSearch } from '@/app/searchSchemas';
import { useCursorPager } from '../../hooks/useCursorPager';

/** The status filter and page cursor live in the URL (bookmarkable, back-button friendly). */
export const useScheduledSearch = () => {
  const search = useSearch({ from: '/app/publishing/scheduled' });
  const navigate = useNavigate({ from: '/publishing/scheduled' });
  const go = (changes: Partial<SchedulesSearch>) =>
    void navigate({ search: (previous) => ({ ...previous, ...changes }) });
  const { pagerProps, resetPager } = useCursorPager(search.cursor, (cursor) => go({ cursor }));
  return {
    search,
    pagerProps,
    setStatus: (status: SchedulesSearch['status']) => {
      resetPager();
      go({ status, cursor: undefined });
    },
  };
};
