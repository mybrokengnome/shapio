import { RefreshCw, TriangleAlert } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { InlineConfirm } from '@/components/InlineConfirm';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

type ConflictBannerProps = {
  /** CONTENT_VERSION_CONFLICT (someone else saved) or SCHEMA_CHANGED (the model changed). */
  code: string;
  busy: boolean;
  onReloadKeepingChanges: () => void;
  onDiscard: () => void;
};

/**
 * A save lost a race: the draft or the model changed since this form loaded. Nothing is overwritten
 * silently: reload the latest version and reapply this person's changes on top, or discard them. The form
 * is read-only meanwhile, so focus moves to the banner (the field being typed in was just disabled).
 */
export const ConflictBanner = ({ code, busy, onReloadKeepingChanges, onDiscard }: ConflictBannerProps) => {
  const { t } = useTranslation();
  const reloadRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    reloadRef.current?.focus();
  }, []);
  return (
    <Alert variant="warning">
      <TriangleAlert aria-hidden="true" />
      <AlertTitle>
        {code === 'SCHEMA_CHANGED' ? t('content.conflict.schemaTitle') : t('content.conflict.title')}
      </AlertTitle>
      <AlertDescription className="space-y-3">
        <p>{t('content.conflict.description')}</p>
        <div className="flex flex-wrap gap-2">
          <Button ref={reloadRef} type="button" size="sm" disabled={busy} onClick={onReloadKeepingChanges}>
            <RefreshCw aria-hidden="true" />
            {t('content.conflict.reload')}
          </Button>
          <InlineConfirm
            tone="danger"
            align="start"
            title={t('content.conflict.discardTitle')}
            description={t('content.conflict.discardDescription')}
            confirmLabel={t('content.conflict.discardConfirm')}
            onConfirm={onDiscard}
            trigger={
              <Button type="button" size="sm" variant="outline" disabled={busy}>
                {t('content.conflict.discard')}
              </Button>
            }
          />
        </div>
      </AlertDescription>
    </Alert>
  );
};
