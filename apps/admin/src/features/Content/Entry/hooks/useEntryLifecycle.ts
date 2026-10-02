import type { AdminEntry, EntryReferrer, MediaAsset } from '@shapio/client';
import type { ComponentDefinition, ModelDefinition } from '@shapio/schema';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  entryQueryOptions,
  useCreateEntry,
  useDeleteEntry,
  useDuplicateEntry,
  useRestoreRevision,
} from '@/api/content';
import type { EntryFormStore } from '@/fields/form/store';
import { contentIssuesOf, isEditConflict, referrersOf } from '@/fields/helpers/apiErrors';
import { buildCreateData } from '@/fields/helpers/formValues';
import { reportError } from '@/helpers/reportError';
import { localizedValuesOf } from '../helpers/initialValues';

type LifecycleOptions = {
  model: ModelDefinition;
  components: ReadonlyMap<string, ComponentDefinition>;
  store: EntryFormStore;
  entryId: string | null;
  locale: string | null;
  defaultLocale: string | undefined;
  versionRef: { current: number | null };
  exclusive: <T>(task: () => Promise<T>) => Promise<T>;
  onAsset: (asset: MediaAsset) => void;
  onConflict: (code: string) => void;
  onRestored: () => void;
};

/**
 * Creating, deleting, duplicating, restoring and copying between locales. Before leaving the form the
 * store is marked clean synchronously, so the unsaved-changes guard doesn't ask about work that was saved.
 */
export const useEntryLifecycle = ({
  model,
  components,
  store,
  entryId,
  locale,
  defaultLocale,
  versionRef,
  exclusive,
  onAsset,
  onConflict,
  onRestored,
}: LifecycleOptions) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const createMutation = useCreateEntry(model.apiKey);
  const deleteMutation = useDeleteEntry(model.apiKey);
  const duplicateMutation = useDuplicateEntry(model.apiKey);
  const restoreMutation = useRestoreRevision(model.apiKey);
  const [referrers, setReferrers] = useState<EntryReferrer[]>([]);
  const markClean = () => flushSync(() => store.getState().load(store.getState().values));
  const openEntry = (entry: AdminEntry) =>
    void navigate({
      to: '/content/$modelKey/$entryId',
      params: { modelKey: model.apiKey, entryId: entry.id },
      search: model.localized ? { locale: entry.locale } : {},
      replace: true,
    });

  const create = async () => {
    store.getState().reveal();
    try {
      const entry = await createMutation.mutateAsync({
        ...(locale ? { locale } : {}),
        data: buildCreateData(store.getState().values),
      });
      markClean();
      toast.success(t('content.form.createdToast'));
      openEntry(entry);
    } catch (error) {
      const issues = contentIssuesOf(error);
      if (issues.length > 0) {
        store.getState().setIssues(issues);
        toast.error(t('content.form.fixProblems', { count: issues.length }));
        return;
      }
      reportError(error, 'creating an entry');
    }
  };

  const remove = async () => {
    if (!entryId) {
      return;
    }
    try {
      await deleteMutation.mutateAsync(entryId);
      markClean();
      toast.success(t('content.form.deletedToast'));
      void navigate({ to: '/content/$modelKey', params: { modelKey: model.apiKey } });
    } catch (error) {
      const found = referrersOf(error);
      if (found.length > 0) {
        setReferrers(found);
        return;
      }
      reportError(error, 'deleting an entry');
    }
  };

  const duplicate = async () => {
    if (!entryId) {
      return;
    }
    const copy = await duplicateMutation.mutateAsync(entryId).catch(() => undefined);
    if (copy) {
      toast.success(t('content.form.duplicatedToast'));
      openEntry(copy);
    }
  };

  const restore = (revisionId: string) =>
    exclusive(async () => {
      if (!entryId || versionRef.current === null) {
        return;
      }
      try {
        await restoreMutation.mutateAsync({ id: entryId, revisionId, expectedVersion: versionRef.current });
        markClean();
        toast.success(t('content.history.restoredToast'));
        onRestored();
      } catch (error) {
        if (isEditConflict(error)) {
          onConflict(error.code);
          return;
        }
        reportError(error, 'restoring a revision');
      }
    });

  const copyFromDefault = async () => {
    if (!entryId || !defaultLocale) {
      return;
    }
    try {
      const source = await queryClient.fetchQuery({
        ...entryQueryOptions(model.apiKey, entryId, defaultLocale),
        staleTime: 0,
      });
      store.getState().patchValues(localizedValuesOf(model, source, components, onAsset));
      toast.success(t('content.locales.copiedToast'));
    } catch (error) {
      reportError(error, 'copying from the default locale');
    }
  };

  return {
    create,
    creating: createMutation.isPending,
    remove,
    duplicate,
    restore,
    restoring: restoreMutation.isPending,
    copyFromDefault,
    referrers,
    clearReferrers: () => setReferrers([]),
  };
};
