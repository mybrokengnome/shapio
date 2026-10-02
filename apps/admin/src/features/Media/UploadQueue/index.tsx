import { ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Panel } from '@/components/Panel';
import { Button } from '@/components/ui/button';
import { useMediaUploadsStore } from '@/stores/mediaUploads';
import { Row } from './Row';

type UploadQueueProps = { onRetry: (id: string) => void; onDismiss: (id: string) => void };

/**
 * Uploads in progress and recently finished, newest last, as a compact panel. Once nothing is running or
 * failed it collapses to one line ("3 uploaded"); failures stay open until retried or dismissed.
 */
export const UploadQueue = ({ onRetry, onDismiss }: UploadQueueProps) => {
  const { t } = useTranslation();
  const items = useMediaUploadsStore((state) => state.items);
  const clearFinished = useMediaUploadsStore((state) => state.clearFinished);
  const [showFinished, setShowFinished] = useState(false);
  if (items.length === 0) {
    return null;
  }
  const active = items.filter((item) => item.status === 'uploading' || item.status === 'confirming').length;
  const failed = items.filter((item) => item.status === 'failed').length;
  const done = items.length - active - failed;
  const settled = active === 0 && failed === 0;
  const expanded = !settled || showFinished;
  return (
    <Panel
      title={t('media.upload.queueTitle')}
      titleAs="h2"
      flush={expanded}
      actions={
        <>
          <span role="status" aria-live="polite" className="text-meta text-muted-foreground">
            {settled
              ? t('media.upload.doneSummary', { count: done })
              : t('media.upload.summary', { active, failed })}
          </span>
          {settled ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-expanded={expanded}
              aria-label={expanded ? t('media.upload.hideFinished') : t('media.upload.showFinished')}
              onClick={() => setShowFinished((current) => !current)}
            >
              {expanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
            </Button>
          ) : null}
          {done > 0 ? (
            <Button variant="ghost" size="sm" onClick={clearFinished}>
              {t('media.upload.clearFinished')}
            </Button>
          ) : null}
        </>
      }
      bodyClassName={expanded ? undefined : 'hidden'}
    >
      {expanded ? (
        <ul className="max-h-64 divide-y overflow-y-auto">
          {items.map((item) => (
            <Row
              key={item.id}
              item={item}
              onRetry={() => onRetry(item.id)}
              onDismiss={() => onDismiss(item.id)}
            />
          ))}
        </ul>
      ) : null}
    </Panel>
  );
};
