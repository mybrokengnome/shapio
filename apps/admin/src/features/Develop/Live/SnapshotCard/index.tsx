import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useSnapshots } from '@/api/snapshots';
import { Panel } from '@/components/Panel';
import { QueryView } from '@/components/QueryView';
import { Badge } from '@/components/ui/badge';
import { formatDateTime, formatRelativeTime } from '@/helpers/formatDate';
import { useActorLabel } from '../../Changes/hooks/useActorLabel';
import { SNAPSHOT_SOURCE_KEYS } from '../../Snapshots/helpers/display';

/** What is being served right now: the current snapshot, since when, and who made it. */
export const SnapshotCard = () => {
  const { t } = useTranslation();
  const actorLabel = useActorLabel();
  const snapshots = useSnapshots(undefined);
  return (
    <Panel title={t('develop.live.snapshotTitle')}>
      <QueryView query={snapshots} loadingRows={2}>
        {(data) => {
          const latest = data.items.find((row) => row.seq === data.current);
          return (
            <div className="space-y-2">
              <Link
                to="/snapshots/$seq"
                params={{ seq: String(data.current) }}
                className="text-title text-link underline-offset-4 hover:underline"
              >
                {t('snapshots.version', { seq: data.current })}
              </Link>
              {latest ? (
                <div className="flex flex-wrap items-center gap-2 text-meta text-muted-foreground">
                  <Badge variant="secondary">{t(SNAPSHOT_SOURCE_KEYS[latest.source])}</Badge>
                  <span title={formatDateTime(latest.createdAt)}>
                    {t('develop.live.since', {
                      at: formatRelativeTime(latest.createdAt),
                      name: actorLabel({ type: latest.actor.type }),
                    })}
                  </span>
                  {latest.schemaVersion === null ? null : (
                    <span>{t('snapshots.schemaVersion', { version: latest.schemaVersion })}</span>
                  )}
                </div>
              ) : null}
            </div>
          );
        }}
      </QueryView>
    </Panel>
  );
};
