import { useTranslation } from 'react-i18next';
import { useMediaUsage } from '@/api/media';
import { ErrorState } from '@/components/ErrorState';
import { Skeleton } from '@/components/ui/skeleton';
import { useContentSchema } from '@/features/Content/hooks/useContentSchema';
import { Row } from './Row';

type UsageProps = { assetId: string };

/** "Used in": the entries whose draft or published version references the asset, by title and type. */
export const Usage = ({ assetId }: UsageProps) => {
  const { t } = useTranslation();
  const usage = useMediaUsage(assetId);
  const { schema } = useContentSchema();
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
          <Row
            key={`${item.entryId}:${item.fieldId}:${item.locale}:${item.state}`}
            usage={item}
            model={schema?.models.get(item.modelId)}
          />
        ))}
      </ul>
    </div>
  );
};
