import type { ChangeSetReview } from '@shapio/client';
import { Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/EmptyState';
import { Panel } from '@/components/Panel';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDateTime, formatRelativeTime } from '@/helpers/formatDate';
import { usePrincipalLabel } from '../../Changes/hooks/usePrincipalLabel';

type ConsumersTabProps = { review: ChangeSetReview };

/** Who read the fields this set's breaking changes affect, from real delivery traffic. */
export const ConsumersTab = ({ review }: ConsumersTabProps) => {
  const { t } = useTranslation();
  const principalLabel = usePrincipalLabel();
  const fields = review.consumers.filter((field) => field.consumers.length > 0);
  if (fields.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title={review.checks.breaking ? t('changes.consumers.none') : t('changes.consumers.notBreaking')}
        description={t('changes.consumers.window', { count: review.usageDays })}
      />
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-meta text-muted-foreground">
        {t('changes.consumers.window', { count: review.usageDays })}
      </p>
      {fields.map((field) => (
        <Panel
          key={`${field.modelId}:${field.fieldId}`}
          title={field.apiKey}
          titleAs="h3"
          flush
          description={t('changes.consumers.readers', { count: field.consumers.length })}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('changes.consumers.reader')}</TableHead>
                <TableHead className="text-right">{t('changes.consumers.reads')}</TableHead>
                <TableHead>{t('changes.consumers.lastRead')}</TableHead>
                <TableHead>{t('changes.consumers.selection')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {field.consumers.map((consumer) => (
                <TableRow key={consumer.principalKey}>
                  <TableCell className="font-semibold">
                    {principalLabel(consumer.principalKey, consumer.label)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{consumer.reads.toLocaleString()}</TableCell>
                  <TableCell className="whitespace-nowrap" title={formatDateTime(consumer.lastReadAt)}>
                    {consumer.lastReadAt ? formatRelativeTime(consumer.lastReadAt) : t('common.never')}
                  </TableCell>
                  <TableCell>
                    <Badge variant={consumer.selection === 'explicit' ? 'secondary' : 'outline'}>
                      {consumer.selection === 'explicit'
                        ? t('changes.consumers.explicit')
                        : t('changes.consumers.implicit')}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      ))}
    </div>
  );
};
