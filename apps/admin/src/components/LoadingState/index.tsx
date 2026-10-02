import { useTranslation } from 'react-i18next';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/helpers/cn';

type LoadingStateProps = { rows?: number; className?: string };

const DEFAULT_ROWS = 4;

export const LoadingState = ({ rows = DEFAULT_ROWS, className }: LoadingStateProps) => {
  const { t } = useTranslation();
  return (
    <div role="status" aria-live="polite" className={cn('space-y-3', className)}>
      <span className="sr-only">{t('common.loading')}</span>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-10 w-full" />
      ))}
    </div>
  );
};
