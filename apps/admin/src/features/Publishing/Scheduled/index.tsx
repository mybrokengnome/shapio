import { SCHEDULE_STATUSES, type ScheduledPublication } from '@shapio/client';
import { CalendarClock, CalendarPlus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useCancelSchedule, useSchedules } from '@/api/schedules';
import { CursorPager } from '@/components/CursorPager';
import { EmptyState } from '@/components/EmptyState';
import { Page } from '@/components/Page';
import { QueryView } from '@/components/QueryView';
import { TableCard } from '@/components/TableCard';
import { Button } from '@/components/ui/button';
import { PUBLISHING_PAGE_SIZE } from '@/constants/publishing';
import { Header } from '../Header';
import { SCHEDULE_STATUS_DISPLAY } from '../helpers/statusDisplay';
import { StatusFilter } from '../StatusFilter';
import { CreateSheet } from './CreateSheet';
import { useScheduledSearch } from './hooks/useScheduledSearch';
import { Table } from './Table';

/** Every scheduled publish and unpublish, with its outcome once it has run. */
export const Scheduled = () => {
  const { t } = useTranslation();
  const { search, pagerProps, setStatus } = useScheduledSearch();
  const schedules = useSchedules({
    status: search.status,
    cursor: search.cursor,
    limit: PUBLISHING_PAGE_SIZE,
  });
  const cancel = useCancelSchedule();
  const [creating, setCreating] = useState(false);
  const cancelSchedule = (schedule: ScheduledPublication) =>
    cancel.mutateAsync(schedule.id, {
      onSuccess: () => toast.success(t('publishing.scheduled.cancelled')),
    });
  const statusOptions = SCHEDULE_STATUSES.map((status) => ({
    value: status,
    label: t(SCHEDULE_STATUS_DISPLAY[status].labelKey),
  }));
  const filters = (
    <div role="search" className="flex flex-wrap items-center gap-2">
      <StatusFilter
        id="scheduled-status"
        label={t('publishing.fields.status')}
        value={search.status}
        options={statusOptions}
        onChange={setStatus}
      />
    </div>
  );
  return (
    <Page>
      <Header
        actions={
          <Button onClick={() => setCreating(true)}>
            <CalendarPlus aria-hidden="true" />
            {t('publishing.scheduled.create')}
          </Button>
        }
      />
      <QueryView
        query={schedules}
        loadingRows={6}
        isEmpty={(data) => data.items.length === 0 && search.cursor === undefined && !search.status}
        empty={<EmptyState icon={CalendarClock} title={t('publishing.scheduled.empty')} />}
      >
        {(data) => (
          <TableCard toolbar={filters} footer={<CursorPager {...pagerProps(data.nextCursor)} />}>
            {data.items.length === 0 ? (
              <EmptyState icon={CalendarClock} size="panel" title={t('publishing.scheduled.noMatches')} />
            ) : (
              <Table schedules={data.items} onCancel={cancelSchedule} />
            )}
          </TableCard>
        )}
      </QueryView>
      <CreateSheet
        open={creating}
        onOpenChange={setCreating}
        onCreated={() => {
          setCreating(false);
          toast.success(t('publishing.scheduled.created'));
        }}
      />
    </Page>
  );
};
