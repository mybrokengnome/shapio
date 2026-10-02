import { CheckCircle2, Loader2, RotateCcw, X, XCircle } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/helpers/cn';
import type { UploadItem } from '@/stores/mediaUploads';
import { describeUploadError } from '../../helpers/describeUploadError';
import { formatBytes } from '../../helpers/formatBytes';

type RowProps = { item: UploadItem; onRetry: () => void; onDismiss: () => void };

const PERCENT = 100;

/** One upload: name, size, progress (a real progressbar), and Retry/Dismiss when it failed. */
export const Row = ({ item, onRetry, onDismiss }: RowProps) => {
  const { t } = useTranslation();
  const percent = Math.round(item.progress * PERCENT);
  const statusText =
    item.status === 'uploading'
      ? t('media.upload.uploading', { percent })
      : item.status === 'confirming'
        ? t('media.upload.checking')
        : item.status === 'done'
          ? t('media.upload.done')
          : describeUploadError(item.error);
  return (
    <li className="flex items-start gap-3 px-5 py-2.5">
      <span className="mt-0.5 shrink-0">
        {item.status === 'done' ? (
          <CheckCircle2 aria-hidden="true" className="size-4 text-success" />
        ) : item.status === 'failed' ? (
          <XCircle aria-hidden="true" className="size-4 text-destructive" />
        ) : (
          <Loader2
            aria-hidden="true"
            className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none"
          />
        )}
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="flex items-baseline gap-2 text-sm">
          <span className="truncate font-medium">{item.file.name}</span>
          <span className="shrink-0 text-meta text-muted-foreground">{formatBytes(item.file.size)}</span>
        </p>
        {item.status === 'uploading' || item.status === 'confirming' ? (
          <div
            role="progressbar"
            aria-label={t('media.upload.progress', { name: item.file.name })}
            aria-valuemin={0}
            aria-valuemax={PERCENT}
            aria-valuenow={percent}
            className="h-1.5 overflow-hidden rounded-full bg-muted"
            style={{ '--upload-progress': `${percent}%` } as CSSProperties}
          >
            <div className="h-full w-[var(--upload-progress)] bg-primary transition-[width]" />
          </div>
        ) : null}
        <p
          className={cn('text-meta', item.status === 'failed' ? 'text-destructive' : 'text-muted-foreground')}
        >
          {statusText}
        </p>
      </div>
      {item.status === 'failed' ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('media.upload.retry', { name: item.file.name })}
          onClick={onRetry}
        >
          <RotateCcw aria-hidden="true" />
        </Button>
      ) : null}
      {item.status === 'failed' || item.status === 'done' ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('media.upload.dismiss', { name: item.file.name })}
          onClick={onDismiss}
        >
          <X aria-hidden="true" />
        </Button>
      ) : null}
    </li>
  );
};
