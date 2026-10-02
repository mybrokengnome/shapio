import type { Locale } from '@shapio/client';
import { useState } from 'react';
import { toast } from 'sonner';
import { hasErrorCode } from '@/api/errors';
import { useDeleteLocale } from '@/api/locales';
import { i18next } from '@/app/i18n';

type WithContent = { locale: Locale; affectedHeads: number };

/** The content count the server reports when a locale with content is deleted without acknowledgement. */
const affectedHeadsOf = (error: unknown): number | null => {
  const details = (error as { details?: { plan?: { impact?: { affectedHeads?: unknown } } } }).details;
  const count = details?.plan?.impact?.affectedHeads;
  return typeof count === 'number' ? count : null;
};

const announceDeleted = (locale: Locale) =>
  toast.success(i18next.t('locales.deleted', { label: locale.label }));

/**
 * Deleting a locale purges its content. The first attempt, from the row's inline confirmation, goes without
 * acknowledgement: an empty locale is simply removed. One holding content is refused with its content count,
 * and the question moves to a blocking dialog where the admin acknowledges that count.
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
      setWithContent({ locale, affectedHeads: affectedHeadsOf(error) ?? 0 });
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
