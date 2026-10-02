import { History } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useChangeSetTimeline } from '@/api/changeSets';
import { EmptyState } from '@/components/EmptyState';
import { QueryView } from '@/components/QueryView';
import { EventRow } from './EventRow';

type TimelineTabProps = { changeSetId: string };

/** What happened to the set, oldest first: created, items added, scheduled, shipped (→ snapshot), deploys. */
export const TimelineTab = ({ changeSetId }: TimelineTabProps) => {
  const { t } = useTranslation();
  const timeline = useChangeSetTimeline(changeSetId);
  return (
    <QueryView
      query={timeline}
      isEmpty={(events) => events.length === 0}
      empty={<EmptyState icon={History} title={t('changes.timeline.empty')} />}
    >
      {(events) => (
        <ol aria-label={t('changes.tabs.timeline')} className="rounded-xl border bg-card p-5 pb-0">
          {events.map((event, index) => (
            <EventRow
              key={`${event.at}-${event.kind}-${index}`}
              event={event}
              last={index === events.length - 1}
            />
          ))}
        </ol>
      )}
    </QueryView>
  );
};
