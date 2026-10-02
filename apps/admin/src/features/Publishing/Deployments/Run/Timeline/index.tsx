import type { DeploymentRun } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@/helpers/formatDate';
import { TIMELINE_SOURCE_LABELS } from '../../../constants';
import { RunStatus } from '../../RunStatus';

type TimelineProps = { run: DeploymentRun };

/** Every status the run went through, oldest first, with who reported it. */
export const Timeline = ({ run }: TimelineProps) => {
  const { t } = useTranslation();
  if (run.timeline.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('publishing.deployments.timelineEmpty')}</p>;
  }
  return (
    <ol aria-label={t('publishing.deployments.timeline')} className="relative ml-1.5 space-y-4 border-l pl-6">
      {run.timeline.map((event, index) => (
        <li key={`${event.at}-${index}`} className="relative">
          <span
            aria-hidden="true"
            className="absolute top-2 -left-7.5 size-2.5 rounded-full border-2 border-card bg-primary"
          />
          <div className="flex flex-wrap items-center gap-2">
            <RunStatus
              run={{
                status: event.status,
                provider: run.provider,
                completionReported: run.completionReported,
              }}
              live={false}
            />
            <time dateTime={event.at} className="text-sm">
              {formatDateTime(event.at)}
            </time>
            <span className="text-meta text-muted-foreground">
              {t('publishing.deployments.reportedBy', { source: t(TIMELINE_SOURCE_LABELS[event.source]) })}
            </span>
          </div>
          {event.message ? <p className="mt-1 text-sm break-words">{event.message}</p> : null}
        </li>
      ))}
    </ol>
  );
};
