import { useTranslation } from 'react-i18next';
import { useMediaUsage } from '@/api/media';
import { ErrorState } from '@/components/ErrorState';
import { StatusChip } from '@/components/StatusChip';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

type UsageProps = { assetId: string };

/** "Used in": the entries whose draft or published version references the asset. */
export const Usage = ({ assetId }: UsageProps) => {
  const { t } = useTranslation();
  const usage = useMediaUsage(assetId);
  if (usage.isPending) {
    return <Skeleton className="h-8 w-full" />;
  }
  if (usage.isError) {
    return <ErrorState error={usage.error} onRetry={() => void usage.refetch()} />;
  }
  if (usage.data.total === 0) {
    return <p className="text-sm text-muted-foreground">{t('media.usage.none')}</p>;
  }
  return (
    <div className="space-y-2">
      <p className="text-sm">{t('media.usage.count', { count: usage.data.total })}</p>
      <ul className="divide-y rounded-lg border">
        {usage.data.items.map((item) => (
          <li
            key={`${item.entryId}:${item.fieldId}:${item.locale}:${item.state}`}
            className="flex min-w-0 items-center gap-2 px-3 py-2"
          >
            <span className="min-w-0 flex-1 truncate font-mono text-xs" title={item.entryId}>
              {t('media.usage.entry', { id: item.entryId })}
            </span>
            <Badge variant="outline" className="font-mono">
              {item.locale}
            </Badge>
            <StatusChip
              size="sm"
              tone={item.state === 'published' ? 'success' : 'neutral'}
              label={item.state === 'published' ? t('media.usage.published') : t('media.usage.draft')}
            />
          </li>
        ))}
      </ul>
    </div>
  );
};
