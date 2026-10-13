import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  useDeleteEntry,
  useDuplicateEntry,
  usePublishEntry,
  useUnpublishEntry,
  type EntryTarget,
} from '@/api/content';
import { queryKeys } from '@/api/queryKeys';
import { expectedVersionOf, type VersionedRow } from '../helpers/expectedVersion';

/** A row an action runs on: the entry and its own kind (a type's list holds its kinds' entries). */
export type RowTarget = Required<EntryTarget>;

/**
 * A list row's quick actions on one entry, in the list's locale. Each returns the request's promise, so an
 * `InlineConfirm` keeps its spinner until it settles and shows the reason when it fails (an invalid entry,
 * one still linked from others, a draft saved since the list loaded). Successes are announced with a toast.
 * Each action runs against the row's own kind (`modelKey`); the mutations refresh its lists and its
 * ancestors' (api/content `invalidateEntryLists`).
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

  const publish = async (row: VersionedRow & RowTarget, label: string) => {
    const expectedVersion = expectedVersionOf(row, locale);
    await publishEntry.mutateAsync({
      id: row.id,
      modelKey: row.modelKey,
      locales,
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
    });
    toast.success(t('place.actions.publishedToast', { entry: label }));
  };
  const unpublish = async (target: RowTarget, label: string) => {
    await unpublishEntry.mutateAsync({ ...target, locales });
    toast.success(t('place.actions.unpublishedToast', { entry: label }));
  };
  const duplicate = (target: RowTarget, label: string) =>
    duplicateEntry.mutate(target, {
      onSuccess: (copy) => {
        void refreshCounts();
        toast.success(t('place.actions.duplicatedToast', { entry: label }), {
          action: {
            label: t('place.actions.openCopy'),
            onClick: () =>
              void navigate({
                to: '/content/$modelKey/$entryId',
                params: { modelKey: copy.model, entryId: copy.id },
                search: locale ? { locale } : {},
              }),
          },
        });
      },
    });
  const remove = async (target: RowTarget, label: string) => {
    await deleteEntry.mutateAsync(target);
    void refreshCounts();
    toast.success(t('place.actions.deletedToast', { entry: label }));
  };
  return { publish, unpublish, duplicate, remove, duplicating: duplicateEntry.isPending };
};
