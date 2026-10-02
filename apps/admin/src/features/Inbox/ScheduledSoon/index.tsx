import { Link } from '@tanstack/react-router';
import { CalendarClock } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSchedules } from '@/api/schedules';
import { EmptyState } from '@/components/EmptyState';
import { Panel } from '@/components/Panel';
import { QueryView } from '@/components/QueryView';
import { Button } from '@/components/ui/button';
import { useContentSchema, findModelByKey } from '@/features/Content/hooks/useContentSchema';
import { SCHEDULED_SHOWN, SCHEDULES_SCANNED } from '../constants';
import { EntryRow } from '../EntryRow';
import { entryLink } from '../helpers/entryLink';
import { useEntryTitles } from '../hooks/useEntryTitles';

const ACTION_KEYS = { publish: 'inbox.scheduledPublish', unpublish: 'inbox.scheduledUnpublish' } as const;

/**
 * The next scheduled publications. Listing every schedule needs `publishing.manage`, so the Inbox mounts
 * this only for admins who hold it.
 */
export const ScheduledSoon = () => {
  const { t } = useTranslation();
  const schedules = useSchedules({ status: 'scheduled', limit: SCHEDULES_SCANNED });
  const { schema } = useContentSchema();
  const soonest = useMemo(
    () =>
      (schedules.data?.items ?? [])
        .filter((schedule) => schedule.modelKey !== null)
        .sort((a, b) => a.runAt.localeCompare(b.runAt))
        .slice(0, SCHEDULED_SHOWN),
    [schedules.data],
  );
  const refs = useMemo(
    () => soonest.map((schedule) => ({ modelKey: schedule.modelKey ?? '', entryId: schedule.entryId })),
    [soonest],
  );
  const titles = useEntryTitles(refs);
  return (
    <Panel
      title={t('inbox.scheduledSoon')}
      flush
      actions={
        <Button variant="ghost" size="sm" asChild>
          <Link to="/publishing/scheduled">{t('inbox.viewAll')}</Link>
        </Button>
      }
    >
      <QueryView
        query={schedules}
        loadingRows={3}
        isEmpty={() => soonest.length === 0}
        empty={
          <EmptyState
            compact
            icon={CalendarClock}
            title={t('inbox.nothingScheduled')}
            description={t('inbox.nothingScheduledDescription')}
          />
        }
      >
        {() => (
          <ul className="divide-y">
            {soonest.map((schedule) => {
              const modelKey = schedule.modelKey ?? '';
              const model = schema ? findModelByKey(schema, modelKey) : undefined;
              return (
                <EntryRow
                  key={schedule.id}
                  title={titles.get(schedule.entryId) ?? t('content.untitled')}
                  meta={t(ACTION_KEYS[schedule.action], { place: model?.label ?? modelKey })}
                  link={entryLink(modelKey, schedule.entryId, model?.kind, { locale: schedule.locale })}
                  at={schedule.runAt}
                />
              );
            })}
          </ul>
        )}
      </QueryView>
    </Panel>
  );
};
