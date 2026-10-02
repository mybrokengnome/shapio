import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useAddChangeSetEntry, useCreateChangeSet } from '@/api/changeSets';
import { useFieldsEnvironment } from '@/fields/form/context';

/**
 * Adds this entry's locale to a change set (published when the set ships), or to a new set created with
 * `title` first; the toast links to the set. Errors stay with the mutations for the popover to show.
 */
export const useAddEntryToChangeSet = (entryId: string, locale: string | null) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { model } = useFieldsEnvironment();
  const addEntry = useAddChangeSetEntry();
  const createChangeSet = useCreateChangeSet();
  const addTo = async (id: string) => {
    const set = await addEntry.mutateAsync({
      id,
      input: { modelKey: model.apiKey, entryId, ...(locale ? { locale } : {}), action: 'publish' },
    });
    toast.success(t('entry.changeSet.added', { title: set.title }), {
      action: {
        label: t('entry.changeSet.open'),
        onClick: () => void navigate({ to: '/changes/$changeSetId', params: { changeSetId: set.id } }),
      },
    });
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
