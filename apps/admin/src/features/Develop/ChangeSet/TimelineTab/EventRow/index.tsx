import type { ChangeSetTimelineEvent } from '@shapio/client';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { StatusChip, type StatusTone } from '@/components/StatusChip';
import { formatDateTime, formatRelativeTime } from '@/helpers/formatDate';
import { useActorLabel } from '../../../Changes/hooks/useActorLabel';

/** Timeline event kinds (D0's TimelineEventSchema) and how each reads. Unknown kinds show their raw name. */
const EVENT_DISPLAY = {
  created: { labelKey: 'changes.timeline.created', tone: 'neutral' },
  updated: { labelKey: 'changes.timeline.updated', tone: 'neutral' },
  item_added: { labelKey: 'changes.timeline.itemAdded', tone: 'neutral' },
  item_removed: { labelKey: 'changes.timeline.itemRemoved', tone: 'muted' },
  schema_draft_saved: { labelKey: 'changes.timeline.schemaDraftSaved', tone: 'neutral' },
  reviewed: { labelKey: 'changes.timeline.reviewed', tone: 'neutral' },
  scheduled: { labelKey: 'changes.timeline.scheduled', tone: 'scheduled' },
  unscheduled: { labelKey: 'changes.timeline.unscheduled', tone: 'muted' },
  shipping: { labelKey: 'changes.timeline.shipping', tone: 'progress' },
  shipped: { labelKey: 'changes.timeline.shipped', tone: 'success' },
  failed: { labelKey: 'changes.timeline.failed', tone: 'danger' },
  discarded: { labelKey: 'changes.timeline.discarded', tone: 'muted' },
  deploy_triggered: { labelKey: 'changes.timeline.deployTriggered', tone: 'progress' },
  deploy_building: { labelKey: 'changes.timeline.deployBuilding', tone: 'progress' },
  deploy_deployed: { labelKey: 'changes.timeline.deployDeployed', tone: 'success' },
  deploy_failed: { labelKey: 'changes.timeline.deployFailed', tone: 'danger' },
} as const satisfies Record<string, { labelKey: string; tone: StatusTone }>;

const isKnownKind = (kind: string): kind is keyof typeof EVENT_DISPLAY => kind in EVENT_DISPLAY;

type EventRowProps = { event: ChangeSetTimelineEvent; last: boolean };

/** One event on the set's timeline, with its snapshot or deploy run when it has one. */
export const EventRow = ({ event, last }: EventRowProps) => {
  const { t } = useTranslation();
  const actorLabel = useActorLabel();
  const display = isKnownKind(event.kind) ? EVENT_DISPLAY[event.kind] : undefined;
  return (
    <li className="flex gap-3">
      <span aria-hidden="true" className="flex flex-col items-center">
        <span className="mt-1.5 size-2.5 shrink-0 rounded-full border-2 border-primary bg-card" />
        {last ? null : <span className="w-px flex-1 bg-border" />}
      </span>
      <div className="min-w-0 flex-1 space-y-1 pb-5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip
            tone={display?.tone ?? 'neutral'}
            label={display ? t(display.labelKey) : event.kind}
            live={false}
            size="sm"
          />
          {event.message ? <span className="text-sm">{event.message}</span> : null}
          {event.snapshot !== null ? (
            <Link
              to="/snapshots/$seq"
              params={{ seq: String(event.snapshot) }}
              className="text-sm font-semibold text-link underline-offset-4 hover:underline"
            >
              {t('snapshots.version', { seq: event.snapshot })}
            </Link>
          ) : null}
          {event.deploymentRunId ? (
            <Link
              to="/publishing/deployments/runs/$runId"
              params={{ runId: event.deploymentRunId }}
              className="text-sm text-link underline-offset-4 hover:underline"
            >
              {t('changes.timeline.deployRun')}
            </Link>
          ) : null}
        </div>
        <p className="text-meta text-muted-foreground">
          {actorLabel(event.actor)} ·{' '}
          <time dateTime={event.at} title={formatDateTime(event.at)}>
            {formatRelativeTime(event.at)}
          </time>
        </p>
      </div>
    </li>
  );
};
