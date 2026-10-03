import { ExternalLink, Link2Off, RotateCw, ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Frame } from '../Frame';
import type { EntryPreview } from '../hooks/useEntryPreview';
import { SdkNotice } from '../SdkNotice';

type BodyProps = { preview: EntryPreview; frameTitle: string };

/** What the pane shows: the framed site, or why it can't (opening, failed, new-tab only, blocked by CSP). */
export const Body = ({ preview, frameTitle }: BodyProps) => {
  const { t } = useTranslation();
  const { session, siteUrl, frameUrl } = preview;
  if (session.status === 'loading') {
    return <LoadingState rows={6} className="p-5" />;
  }
  if (session.status === 'error') {
    return <ErrorState size="panel" className="p-5" error={session.error} onRetry={session.retry} />;
  }
  if (!siteUrl) {
    return (
      <EmptyState
        size="panel"
        icon={Link2Off}
        title={t('entry.preview.noUrlTitle')}
        description={t('entry.preview.noUrlDescription')}
      />
    );
  }
  if (!frameUrl) {
    return (
      <EmptyState
        size="panel"
        icon={ExternalLink}
        title={t('entry.preview.notFramableTitle')}
        description={t('entry.preview.notFramableDescription')}
        action={
          <Button asChild>
            <a href={siteUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
              <ExternalLink aria-hidden="true" />
              {t('entry.preview.openInTab')}
            </a>
          </Button>
        }
      />
    );
  }
  return (
    <>
      {preview.blocked ? (
        <Alert variant="warning" className="rounded-none border-x-0 border-t-0">
          <ShieldAlert aria-hidden="true" />
          <AlertTitle>{t('entry.preview.blockedTitle')}</AlertTitle>
          <AlertDescription>
            <p>{t('entry.preview.blockedDescription')}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => window.location.reload()}
            >
              <RotateCw aria-hidden="true" />
              {t('entry.preview.reloadAdmin')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : preview.missing ? (
        <SdkNotice />
      ) : null}
      <Frame frameRef={preview.frameRef} src={frameUrl} title={frameTitle} onLoad={preview.onFrameLoad} />
    </>
  );
};
