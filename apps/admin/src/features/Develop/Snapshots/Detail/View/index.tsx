import type { Snapshot } from '@shapio/client';
import { linkOptions, useNavigate, useSearch } from '@tanstack/react-router';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSnapshotChanges, useSnapshots } from '@/api/snapshots';
import { Page } from '@/components/Page';
import { PageHeader } from '@/components/PageHeader';
import { QueryView } from '@/components/QueryView';
import { StatusChip } from '@/components/StatusChip';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatDateTime } from '@/helpers/formatDate';
import { useActorLabel } from '../../../Changes/hooks/useActorLabel';
import { SNAPSHOT_SOURCE_KEYS } from '../../helpers/display';
import { PinPopover } from '../../PinPopover';
import { RestoreButton } from '../../RestoreButton';
import { SNAPSHOT_TABS, type SnapshotTab } from '../../searchSchema';
import { Timeline } from '../../Timeline';
import { ChangeList } from '../ChangeList';

const TAB_LABEL_KEYS = {
  diff: 'snapshots.tabs.diff',
  timeline: 'snapshots.tabs.timeline',
} as const satisfies Record<SnapshotTab, string>;

type ViewProps = { snapshot: Snapshot };

export const View = ({ snapshot }: ViewProps) => {
  const { t } = useTranslation();
  const actorLabel = useActorLabel();
  const search = useSearch({ from: '/app/snapshots/$seq' });
  const navigate = useNavigate({ from: '/snapshots/$seq' });
  const tab = search.tab ?? 'diff';
  const onAtChange = useCallback(
    (at: number) => void navigate({ search: (prev) => ({ ...prev, at }), replace: true }),
    [navigate],
  );
  const from = search.from !== undefined && search.from < snapshot.seq ? search.from : snapshot.seq - 1;
  const ledger = useSnapshots(undefined);
  const current = ledger.data?.current;
  const changes = useSnapshotChanges(from, snapshot.seq, tab === 'diff');
  const meta = [
    formatDateTime(snapshot.createdAt),
    actorLabel({ type: snapshot.actor.type }),
    snapshot.schemaVersion === null ? '' : t('snapshots.schemaVersion', { version: snapshot.schemaVersion }),
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Page>
      <Tabs
        value={tab}
        onValueChange={(value) =>
          void navigate({ search: (prev) => ({ ...prev, tab: value as SnapshotTab }), replace: true })
        }
        className="gap-6"
      >
        <PageHeader
          breadcrumb={[{ label: t('snapshots.title'), link: linkOptions({ to: '/snapshots' }) }]}
          title={t('snapshots.version', { seq: snapshot.seq })}
          badge={
            <>
              <Badge variant="secondary">{t(SNAPSHOT_SOURCE_KEYS[snapshot.source])}</Badge>
              {snapshot.seq === current ? <StatusChip tone="success" label={t('snapshots.live')} /> : null}
            </>
          }
          meta={meta}
          actions={
            <>
              <PinPopover seq={snapshot.seq} />
              {current !== undefined && snapshot.seq !== current ? (
                <RestoreButton seq={snapshot.seq} size="default" />
              ) : null}
            </>
          }
          tabs={
            <TabsList variant="underline" aria-label={t('snapshots.tabs.label')}>
              {SNAPSHOT_TABS.map((key) => (
                <TabsTrigger key={key} value={key}>
                  {t(TAB_LABEL_KEYS[key])}
                </TabsTrigger>
              ))}
            </TabsList>
          }
        />
        <TabsContent value="diff">
          <QueryView query={changes} loadingRows={4}>
            {(page) => <ChangeList page={page} />}
          </QueryView>
        </TabsContent>
        <TabsContent value="timeline">
          <Timeline at={search.at ?? snapshot.seq} onAtChange={onAtChange} />
        </TabsContent>
      </Tabs>
    </Page>
  );
};
