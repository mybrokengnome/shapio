import type { ScheduledPublication } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { InlineConfirm } from '@/components/InlineConfirm';
import { RowTitle } from '@/components/RowTitle';
import { StatusChip } from '@/components/StatusChip';
import { Button } from '@/components/ui/button';
import {
  Table as TableRoot,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDateTime } from '@/helpers/formatDate';
import { PUBLICATION_ACTION_LABELS } from '../../constants';
import { SCHEDULE_STATUS_DISPLAY } from '../../helpers/statusDisplay';

type TableProps = {
  schedules: ScheduledPublication[];
  /** Cancels after an inline confirmation; the promise keeps it open until the request settles. */
  onCancel: (schedule: ScheduledPublication) => Promise<unknown>;
};

export const Table = ({ schedules, onCancel }: TableProps) => {
  const { t } = useTranslation();
  return (
    <TableRoot>
      <TableHeader>
        <TableRow>
          <TableHead>{t('publishing.fields.entryId')}</TableHead>
          <TableHead>{t('publishing.fields.model')}</TableHead>
          <TableHead>{t('publishing.fields.locale')}</TableHead>
          <TableHead>{t('publishing.fields.action')}</TableHead>
          <TableHead>{t('publishing.fields.runAt')}</TableHead>
          <TableHead>{t('publishing.fields.status')}</TableHead>
          <TableHead>{t('publishing.fields.error')}</TableHead>
          <TableHead>
            <span className="sr-only">{t('common.actions')}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {schedules.map((schedule) => {
          const status = SCHEDULE_STATUS_DISPLAY[schedule.status];
          return (
            <TableRow key={schedule.id}>
              <TableCell className="max-w-44">
                <RowTitle className="block truncate font-mono text-xs">
                  <span title={schedule.entryId}>{schedule.entryId}</span>
                </RowTitle>
              </TableCell>
              <TableCell className="font-mono text-xs">
                {schedule.modelKey ?? t('publishing.fields.deletedModel')}
              </TableCell>
              <TableCell className="font-mono text-xs">{schedule.locale}</TableCell>
              <TableCell>{t(PUBLICATION_ACTION_LABELS[schedule.action])}</TableCell>
              <TableCell className="whitespace-nowrap">{formatDateTime(schedule.runAt)}</TableCell>
              <TableCell>
                <StatusChip tone={status.tone} label={t(status.labelKey)} />
              </TableCell>
              <TableCell className="max-w-64 whitespace-normal">
                {schedule.error ? (
                  <span className="text-destructive">{schedule.error}</span>
                ) : (
                  <span className="text-muted-foreground">{t('common.none')}</span>
                )}
              </TableCell>
              <TableCell className="text-right">
                {schedule.status === 'scheduled' ? (
                  <InlineConfirm
                    tone="danger"
                    title={t('publishing.scheduled.cancelTitle')}
                    description={t('publishing.scheduled.cancelDescription', { entryId: schedule.entryId })}
                    confirmLabel={t('publishing.scheduled.cancel')}
                    cancelLabel={t('publishing.scheduled.keep')}
                    onConfirm={() => onCancel(schedule)}
                    trigger={
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={t('publishing.scheduled.cancelLabel', { entryId: schedule.entryId })}
                      >
                        {t('publishing.scheduled.cancel')}
                      </Button>
                    }
                  />
                ) : null}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </TableRoot>
  );
};
