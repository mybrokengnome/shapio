import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useState } from 'react';
import { isConflict } from '@/api/errors';

/**
 * Optimistic concurrency on an edit page: when a save answers 409 (someone else saved first), the latest
 * version is reloaded and the page says so, instead of overwriting their change.
 */
export const useConflictReload = (queryKey: QueryKey) => {
  const queryClient = useQueryClient();
  const [conflicted, setConflicted] = useState(false);
  return {
    conflicted,
    clearConflict: () => setConflicted(false),
    /** Pass as a mutation's `onError`: other errors are left to the form. */
    onSaveError: (error: unknown) => {
      if (isConflict(error)) {
        setConflicted(true);
        void queryClient.invalidateQueries({ queryKey });
      }
    },
  };
};
