import { AlertCircle, Loader2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSchemaChange } from '@/api/schema';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FINAL_CHANGE_STATUSES } from '@/constants/schema';

type ChangeProgressProps = {
  changeId: string;
  onFinished: (status: string) => void;
  onDismiss: () => void;
};

type ChangeFailure = { reason?: unknown; invalidCount?: unknown };

const failureOf = (error: unknown): ChangeFailure =>
  typeof error === 'object' && error !== null ? error : {};

/**
 * A schema change whose prerequisites run as jobs: progress while they run, then either the success
 * (reported to the builder, which reloads) or why it failed, with the previous version still active.
 */
export const ChangeProgress = ({ changeId, onFinished, onDismiss }: ChangeProgressProps) => {
  const { t } = useTranslation();
  const change = useSchemaChange(changeId);
  const status = change.data?.status;
  const reported = useRef(false);
  useEffect(() => {
    if (status && FINAL_CHANGE_STATUSES.has(status) && !reported.current) {
      reported.current = true;
      onFinished(status);
    }
  }, [status, onFinished]);
  if (status === 'activated') {
    return null;
  }
  if (status === 'failed' || status === 'cancelled') {
    const failure = failureOf(change.data?.error);
    return (
      <Alert variant="destructive">
        <AlertCircle aria-hidden="true" />
        <AlertTitle>{t('models.progress.failedTitle')}</AlertTitle>
        <AlertDescription>
          <p>{t('models.progress.failedDescription')}</p>
          {typeof failure.invalidCount === 'number' ? (
            <p>{t('models.progress.invalidCount', { count: failure.invalidCount })}</p>
          ) : null}
          {typeof failure.reason === 'string' ? <p>{failure.reason}</p> : null}
          <Button type="button" size="sm" variant="outline" className="mt-2" onClick={onDismiss}>
            {t('common.close')}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert variant="info" role="status">
      <Loader2 className="animate-spin" aria-hidden="true" />
      <AlertTitle>{t('models.progress.runningTitle')}</AlertTitle>
      <AlertDescription>{t('models.progress.runningDescription')}</AlertDescription>
    </Alert>
  );
};
