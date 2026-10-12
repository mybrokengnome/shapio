import type { AdminEntry, ShapioApiError } from '@shapio/client';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type MutableRefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { entryQueryOptions, usePublishEntry, useUnpublishEntry } from '@/api/content';
import type { EntryFormStore } from '@/fields/form/store';
import { contentIssuesOf, isEditConflict } from '@/fields/helpers/apiErrors';
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
  /** The draft version this document shows; publish sends it so a draft saved elsewhere since is refused. */
  versionRef: MutableRefObject<number | null>;
  /** Every locale's state as last read (its draft version guards "publish the other locales too"). */
  entryLocales: AdminEntry['locales'];
  store: EntryFormStore;
  save: (kind: SaveKind) => Promise<SaveOutcome>;
  exclusive: <T>(task: () => Promise<T>) => Promise<T>;
  onEntry: (entry: AdminEntry) => void;
  /** Someone else saved since this document loaded: the conflict banner takes over, nothing is published. */
  onConflict: (error: ShapioApiError) => void;
};

/**
 * Publishing is per locale (ADR 0004): publishing this locale never changes another locale's live content.
 * Unsaved or autosaved changes are saved first (fully validated). When other published locales still serve
 * older shared values the document offers to publish them too; `othersDismissed` hides that notice until
 * the next publish. Every publish carries the draft versions this document saw, so a stale tab gets the
 * conflict banner instead of publishing a draft it never showed.
 */
export const usePublishing = ({
  modelKey,
  entryId,
  autosaved,
  locale,
  versionRef,
  entryLocales,
  store,
  save,
  exclusive,
  onEntry,
  onConflict,
}: PublishingOptions) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const publishMutation = usePublishEntry(modelKey);
  const unpublishMutation = useUnpublishEntry(modelKey);
  const [othersDismissed, setOthersDismissed] = useState(false);
  // A non-localized model has no locale: omit `locales` so the API uses its default.
  const locales = locale ? [locale] : undefined;

  /** Resolves true when the pre-flight should close: this locale went live, or the conflict banner took over. */
  const publish = async (): Promise<boolean> => {
    if (!entryId) {
      return false;
    }
    const { values, baseline } = store.getState();
    if (dirtyKeysOf(values, baseline).length > 0 || autosaved) {
      const outcome = await save('save');
      if (outcome !== 'saved') {
        return outcome === 'conflict';
      }
    }
    return exclusive(async () => {
      try {
        const expectedVersion = versionRef.current;
        const published = await publishMutation.mutateAsync({
          id: entryId,
          locales,
          ...(expectedVersion !== null ? { expectedVersion } : {}),
        });
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
        if (isEditConflict(error)) {
          onConflict(error);
          return true;
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
        const expectedVersions = Object.fromEntries(
          entryLocales
            .filter((state) => others.includes(state.locale))
            .map((state) => [state.locale, state.version]),
        );
        await publishMutation.mutateAsync({ id: entryId, locales: others, expectedVersions });
        onEntry(
          await queryClient.fetchQuery({
            ...entryQueryOptions(modelKey, entryId, locale ?? undefined),
            staleTime: 0,
          }),
        );
        toast.success(t('content.form.publishedOthersToast', { count: others.length }));
      } catch (error) {
        if (isEditConflict(error)) {
          onConflict(error);
          return;
        }
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
