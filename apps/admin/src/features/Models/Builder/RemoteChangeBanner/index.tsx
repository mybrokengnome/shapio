import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

type RemoteChangeBannerProps = {
  /**
   * Why it shows: `remote`, another session activated a newer version (noticed by polling); `conflict`,
   * this session's own review or save was refused because the version moved (a rejected non-fast-forward).
   */
  reason: 'remote' | 'conflict';
  /** There are unsaved edits, so the admin chooses what happens to them. */
  dirty: boolean;
  /** Start over from the latest version (unsaved edits are dropped). */
  onReload: () => void;
  /** Keep the edits on top of the latest version and review again. */
  onKeepEdits: () => void;
};

/**
 * The definition moved on while this admin was editing. Nothing is discarded silently: with unsaved edits
 * the admin takes the latest version or keeps their edits on top of it; without, they reload. A conflict
 * from their own save is announced at once (alert); a change noticed in the background politely (status).
 */
export const RemoteChangeBanner = ({ reason, dirty, onReload, onKeepEdits }: RemoteChangeBannerProps) => {
  const { t } = useTranslation();
  const choose = dirty || reason === 'conflict';
  return (
    <Alert
      variant="warning"
      role={reason === 'conflict' ? 'alert' : 'status'}
      className="flex flex-wrap items-center justify-between gap-3"
    >
      <div className="flex items-start gap-3">
        <RefreshCw className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div>
          <AlertTitle>{t('models.remote.title')}</AlertTitle>
          <AlertDescription>
            {t(choose ? 'models.remote.chooseDescription' : 'models.remote.description')}
          </AlertDescription>
        </div>
      </div>
      {choose ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={onKeepEdits}>
            {t('models.remote.keepEdits')}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onReload}>
            {t('models.remote.reloadLatest')}
          </Button>
        </div>
      ) : (
        <Button type="button" size="sm" variant="outline" onClick={onReload}>
          {t('models.remote.reload')}
        </Button>
      )}
    </Alert>
  );
};
