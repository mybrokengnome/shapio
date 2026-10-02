import type { AdminEntry } from '@shapio/client';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { entryQueryOptions, usePublishEntry, useUnpublishEntry } from '@/api/content';
import type { EntryFormStore } from '@/fields/form/store';
import { contentIssuesOf } from '@/fields/helpers/apiErrors';
import { dirtyKeysOf } from '@/fields/helpers/formValues';
import { reportError } from '@/helpers/reportError';
import type { SaveKind, SaveOutcome } from './useEntrySaver';

type PublishingOptions = {
  modelKey: string;
  /** Null while the entry is not created yet (nothing to publish). */
  entryId: string | null;
  /** The draft holds autosaved work that has not been validated by a Save. */
  autosaved: boolean;
  locale: string | null;
  store: EntryFormStore;
  save: (kind: SaveKind) => Promise<SaveOutcome>;
  exclusive: <T>(task: () => Promise<T>) => Promise<T>;
  onEntry: (entry: AdminEntry) => void;
};

/**
 * Publishing is per locale (ADR 0004): publishing this locale never changes another locale's live content.
 * Unsaved or autosaved changes are saved first (fully validated). When other published locales still serve
 * older shared values the document offers to publish them too; `othersDismissed` hides that notice until
 * the next publish.
 */
export const usePublishing = ({
  modelKey,
  entryId,
  autosaved,
  locale,
  store,
  save,
  exclusive,
  onEntry,
}: PublishingOptions) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const publishMutation = usePublishEntry(modelKey);
  const unpublishMutation = useUnpublishEntry(modelKey);
  const [othersDismissed, setOthersDismissed] = useState(false);
  // A non-localized model has no locale: omit `locales` so the API uses its default.
  const locales = locale ? [locale] : undefined;

  /** Resolves true when this locale went live (the pre-flight closes then). */
  const publish = async (): Promise<boolean> => {
    if (!entryId) {
      return false;
    }
    const { values, baseline } = store.getState();
    if (dirtyKeysOf(values, baseline).length > 0 || autosaved) {
      if ((await save('save')) !== 'saved') {
        return false;
      }
    }
    return exclusive(async () => {
      try {
        const published = await publishMutation.mutateAsync({ id: entryId, locales });
        onEntry(published);
        toast.success(t('content.form.publishedToast'));
        setOthersDismissed(false);
        return true;
      } catch (error) {
        const issues = contentIssuesOf(error);
        if (issues.length > 0) {
          store.getState().setIssues(issues);
          store.getState().reveal();
          toast.error(t('content.form.fixProblems', { count: issues.length }));
          return false;
        }
        reportError(error, 'publishing an entry');
        return false;
      }
    });
  };

  const publishOthers = async (others: string[]) => {
    if (!entryId) {
      return;
    }
    await exclusive(async () => {
      try {
        // The response describes the first published locale; re-read the one being edited.
        await publishMutation.mutateAsync({ id: entryId, locales: others });
        onEntry(
          await queryClient.fetchQuery({
            ...entryQueryOptions(modelKey, entryId, locale ?? undefined),
            staleTime: 0,
          }),
        );
        toast.success(t('content.form.publishedOthersToast', { count: others.length }));
      } catch (error) {
        reportError(error, 'publishing other locales');
      }
    });
  };

  const unpublish = () =>
    exclusive(async () => {
      if (!entryId) {
        return;
      }
      try {
        onEntry(await unpublishMutation.mutateAsync({ id: entryId, locales }));
        toast.success(t('content.form.unpublishedToast'));
      } catch (error) {
        reportError(error, 'unpublishing an entry');
      }
    });

  return {
    publish,
    publishOthers,
    unpublish,
    othersDismissed,
    dismissOthers: () => setOthersDismissed(true),
    publishing: publishMutation.isPending,
    unpublishing: unpublishMutation.isPending,
  };
};
