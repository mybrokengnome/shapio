import type { Locale } from '@shapio/client';
import { useState } from 'react';
import { toast } from 'sonner';
import { hasErrorCode } from '@/api/errors';
import { useDeleteLocale } from '@/api/locales';
import { i18next } from '@/app/i18n';

type WithContent = { locale: Locale; affectedHeads: number; deletedEntries: number };

/**
 * The content counts the server reports when a locale with content is deleted without acknowledgement:
 * entry versions purged, and entries that exist only in that locale (deleted outright).
 */
const impactOf = (error: unknown): Omit<WithContent, 'locale'> => {
  const impact = (error as { details?: { plan?: { impact?: Record<string, unknown> } } }).details?.plan
    ?.impact;
  const count = (value: unknown) => (typeof value === 'number' ? value : 0);
  return { affectedHeads: count(impact?.affectedHeads), deletedEntries: count(impact?.deletedEntries) };
};

const announceDeleted = (locale: Locale) =>
  toast.success(i18next.t('locales.deleted', { label: locale.label }));

/**
 * Deleting a locale purges its content. The first attempt, from the row's inline confirmation, goes without
 * acknowledgement: an empty locale is simply removed. One holding content is refused with its content counts,
 * and the question moves to a blocking dialog where the admin acknowledges them.
 */
export const useDeleteLocaleFlow = () => {
  const deleteLocale = useDeleteLocale();
  const [withContent, setWithContent] = useState<WithContent | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const attempt = async (locale: Locale) => {
    try {
      await deleteLocale.mutateAsync({ code: locale.code, acknowledged: false });
    } catch (error) {
      if (!hasErrorCode(error, 'SCHEMA_CHANGE_NOT_ACKNOWLEDGED')) {
        throw error;
      }
      deleteLocale.reset();
      setWithContent({ locale, ...impactOf(error) });
      setOpen(true);
      return;
    }
    announceDeleted(locale);
  };
  const confirm = () => {
    if (!withContent) {
      return;
    }
    deleteLocale.mutate(
      { code: withContent.locale.code, acknowledged: true },
      {
        onSuccess: () => {
          announceDeleted(withContent.locale);
          setOpen(false);
        },
      },
    );
  };
  return {
    attempt,
    withContent,
    open,
    onOpenChange: setOpen,
    confirm,
    pending: deleteLocale.isPending,
    error: deleteLocale.error,
  };
};
