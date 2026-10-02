import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { adminApi } from '@/api/client';
import { withCsrf } from '@/api/csrf';
import { describeError } from '@/helpers/describeError';
import { logError } from '@/helpers/reportError';

/**
 * Opens an entry's draft on the site (the first connection with a preview URL template). The tab opens on
 * the click, so browsers don't block it, and is pointed at the preview once the token exists.
 */
export const usePreviewEntry = (modelKey: string, locale: string | null) => {
  const { t } = useTranslation();
  const open = useMutation({
    mutationKey: ['preview', 'open', modelKey],
    meta: { silent: true },
    mutationFn: (entryId: string) =>
      withCsrf(() => adminApi.preview.open({ modelKey, entryId, ...(locale ? { locale } : {}) })),
  });
  const preview = (entryId: string) => {
    const tab = window.open('about:blank', '_blank');
    open.mutate(entryId, {
      onSuccess: (result) => {
        if (result.url && tab) {
          tab.opener = null;
          tab.location.href = result.url;
          return;
        }
        tab?.close();
        toast.info(t('place.actions.previewUnavailable'));
      },
      onError: (error) => {
        tab?.close();
        logError(error, `preview of ${modelKey}/${entryId}`);
        toast.error(describeError(error));
      },
    });
  };
  return { preview, pending: open.isPending };
};
