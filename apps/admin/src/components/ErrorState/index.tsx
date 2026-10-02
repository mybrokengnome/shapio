import { AlertTriangle, Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isForbidden } from '@/api/errors';
import { Button } from '@/components/ui/button';
import { describeError } from '@/helpers/describeError';
import { EmptyState } from '../EmptyState';

type ErrorStateProps = {
  error: unknown;
  onRetry?: () => void;
  /** `panel` inside a Panel or TableCard (no surface of its own), `page` on its own (default). */
  size?: 'panel' | 'page';
  className?: string;
};

/** A failed load, shown in place of the content. 403 gets its own message (retrying won't help). */
export const ErrorState = ({ error, onRetry, size = 'page', className }: ErrorStateProps) => {
  const { t } = useTranslation();
  if (isForbidden(error)) {
    return (
      <EmptyState
        icon={Lock}
        title={t('errors.forbidden')}
        description={t('errors.forbiddenDescription')}
        size={size}
        className={className}
      />
    );
  }
  return (
    <div role="alert">
      <EmptyState
        icon={AlertTriangle}
        title={t('errors.loadFailed')}
        description={describeError(error)}
        action={
          onRetry ? (
            <Button variant="outline" onClick={onRetry}>
              {t('common.retry')}
            </Button>
          ) : undefined
        }
        size={size}
        className={className}
      />
    </div>
  );
};
