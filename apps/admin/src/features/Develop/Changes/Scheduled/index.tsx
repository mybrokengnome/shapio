import { CalendarClock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSchedules } from '@/api/schedules';
import { EmptyState } from '@/components/EmptyState';
import { Panel } from '@/components/Panel';
import { QueryView } from '@/components/QueryView';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PUBLISHING_PAGE_SIZE } from '@/constants/publishing';
import { PUBLICATION_ACTION_LABELS } from '@/features/Publishing/constants';
import { formatDateTime, formatRelativeTime } from '@/helpers/formatDate';

/** Single-entry scheduled publications, read-only here (they are managed under Publishing → Scheduled). */
export const Scheduled = () => {
  const { t } = useTranslation();
  const schedules = useSchedules({ status: 'scheduled', limit: PUBLISHING_PAGE_SIZE });
  return (
    <Panel title={t('changes.scheduledPublications')} flush>
      <QueryView
        query={schedules}
        isEmpty={(data) => data.items.length === 0}
        empty={<EmptyState icon={CalendarClock} size="panel" title={t('changes.noScheduledPublications')} />}
      >
        {(data) => (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('changes.fields.model')}</TableHead>
                <TableHead>{t('changes.fields.entry')}</TableHead>
                <TableHead>{t('changes.fields.locale')}</TableHead>
                <TableHead>{t('changes.fields.action')}</TableHead>
                <TableHead>{t('changes.fields.when')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((schedule) => (
                <TableRow key={schedule.id}>
                  <TableCell className="font-mono text-xs">
                    {schedule.modelKey ?? t('common.unknown')}
                  </TableCell>
                  <TableCell className="max-w-48">
                    <span className="block truncate font-mono text-xs" title={schedule.entryId}>
                      {schedule.entryId}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{schedule.locale}</TableCell>
                  <TableCell>{t(PUBLICATION_ACTION_LABELS[schedule.action])}</TableCell>
                  <TableCell className="whitespace-nowrap" title={formatDateTime(schedule.runAt)}>
                    {formatRelativeTime(schedule.runAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </QueryView>
    </Panel>
  );
};
