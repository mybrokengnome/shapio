import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useDeleteEntry, useDuplicateEntry, usePublishEntry, useUnpublishEntry } from '@/api/content';
import { queryKeys } from '@/api/queryKeys';

/**
 * A list row's quick actions on one entry, in the list's locale. Each returns the request's promise, so an
 * `InlineConfirm` keeps its spinner until it settles and shows the reason when it fails (an invalid entry,
 * one still linked from others). Successes are announced with a toast.
 */
export const useRowActions = (modelKey: string, locale: string | null) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const publishEntry = usePublishEntry(modelKey);
  const unpublishEntry = useUnpublishEntry(modelKey);
  const duplicateEntry = useDuplicateEntry(modelKey);
  const deleteEntry = useDeleteEntry(modelKey);
  const locales = locale ? [locale] : undefined;
  const refreshCounts = () => queryClient.invalidateQueries({ queryKey: queryKeys.contentCounts });

  const publish = async (id: string, label: string) => {
    await publishEntry.mutateAsync({ id, locales });
    toast.success(t('place.actions.publishedToast', { entry: label }));
  };
  const unpublish = async (id: string, label: string) => {
    await unpublishEntry.mutateAsync({ id, locales });
    toast.success(t('place.actions.unpublishedToast', { entry: label }));
  };
  const duplicate = (id: string, label: string) =>
    duplicateEntry.mutate(id, {
      onSuccess: (copy) => {
        void refreshCounts();
        toast.success(t('place.actions.duplicatedToast', { entry: label }), {
          action: {
            label: t('place.actions.openCopy'),
            onClick: () =>
              void navigate({
                to: '/content/$modelKey/$entryId',
                params: { modelKey, entryId: copy.id },
                search: locale ? { locale } : {},
              }),
          },
        });
      },
    });
  const remove = async (id: string, label: string) => {
    await deleteEntry.mutateAsync(id);
    void refreshCounts();
    toast.success(t('place.actions.deletedToast', { entry: label }));
  };
  return { publish, unpublish, duplicate, remove, duplicating: duplicateEntry.isPending };
};
