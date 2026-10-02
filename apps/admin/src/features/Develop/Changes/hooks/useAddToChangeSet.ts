import type { UnassignedEntry } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useAddChangeSetEntry, useCreateChangeSet } from '@/api/changeSets';

/**
 * Adds an unassigned entry draft to a set (to publish it when the set ships), or to a new set created
 * with `title` first. Resolves when done; errors stay with the mutations for the popover to show.
 */
export const useAddToChangeSet = (entry: UnassignedEntry) => {
  const { t } = useTranslation();
  const addEntry = useAddChangeSetEntry();
  const createChangeSet = useCreateChangeSet();
  const input = {
    modelKey: entry.modelKey ?? '',
    entryId: entry.entryId,
    locale: entry.locale,
    action: 'publish' as const,
  };
  const addTo = async (id: string) => {
    const set = await addEntry.mutateAsync({ id, input });
    toast.success(t('changes.added', { title: set.title }));
  };
  return {
    addTo,
    createAndAdd: async (title: string) => {
      const set = await createChangeSet.mutateAsync({ title });
      await addTo(set.id);
    },
    pending: addEntry.isPending || createChangeSet.isPending,
    error: addEntry.error ?? createChangeSet.error,
    reset: () => {
      addEntry.reset();
      createChangeSet.reset();
    },
  };
};
