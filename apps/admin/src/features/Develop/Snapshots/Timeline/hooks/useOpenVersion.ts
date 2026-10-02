import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { adminApi } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import { describeError } from '@/helpers/describeError';
import { logError } from '@/helpers/reportError';
import type { TimelineCard } from '../helpers/cards';

/** Revisions that can have gone live, newest first among those that existed at the snapshot. */
const PUBLISHING_REASONS: ReadonlySet<string> = new Set(['publish', 'restore']);

/**
 * "Open this version": the entry's history at the revision it served at the snapshot. The diff names that
 * revision for entries that changed at the snapshot; for the others it is the newest published (or
 * restored) revision of the locale from before the snapshot was taken.
 */
export const useOpenVersion = (modelKey: string, snapshotCreatedAt: string | undefined) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const revisionAt = async (entryId: string, locale: string) => {
    const revisions = await queryClient.fetchQuery({
      queryKey: queryKeys.content.revisions(modelKey, entryId, locale),
      queryFn: () => adminApi.content.revisions(modelKey, entryId, { locale }),
    });
    const before = revisions.filter(
      (revision) => snapshotCreatedAt === undefined || revision.createdAt <= snapshotCreatedAt,
    );
    const newest = (list: typeof before) =>
      [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.id;
    return newest(before.filter((revision) => PUBLISHING_REASONS.has(revision.reason))) ?? newest(before);
  };
  return async (card: TimelineCard) => {
    const locale = card.locales[0];
    try {
      const revision =
        (locale ? card.revisionIds[locale] : undefined) ??
        (locale ? await revisionAt(card.id, locale) : undefined);
      await navigate({
        to: '/content/$modelKey/$entryId',
        params: { modelKey, entryId: card.id },
        search: { ...(locale ? { locale } : {}), ...(revision ? { revision } : {}) },
      });
    } catch (error) {
      logError(error, 'opening an entry version from the timeline');
      toast.error(describeError(error));
    }
  };
};
