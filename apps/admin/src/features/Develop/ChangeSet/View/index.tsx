import type { ChangeSet } from '@shapio/client';
import { linkOptions, useNavigate, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useChangeSetReview } from '@/api/changeSets';
import { Page } from '@/components/Page';
import { PageHeader } from '@/components/PageHeader';
import { QueryView } from '@/components/QueryView';
import { StatusChip } from '@/components/StatusChip';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatDateTime, formatRelativeTime } from '@/helpers/formatDate';
import { CHANGE_SET_STATUS_DISPLAY, EDITABLE_STATUSES } from '../../Changes/constants';
import { useActorLabel } from '../../Changes/hooks/useActorLabel';
import { Actions } from '../Actions';
import { Banners } from '../Banners';
import { ChangesTab } from '../ChangesTab';
import { ChecksTab } from '../ChecksTab';
import { ConsumersTab } from '../ConsumersTab';
import { useShipFlow } from '../hooks/useShipFlow';
import { RenamePopover } from '../RenamePopover';
import { CHANGE_SET_TABS, type ChangeSetTab } from '../searchSchema';
import { TimelineTab } from '../TimelineTab';

const TAB_LABEL_KEYS = {
  changes: 'changes.tabs.changes',
  checks: 'changes.tabs.checks',
  consumers: 'changes.tabs.consumers',
  timeline: 'changes.tabs.timeline',
} as const satisfies Record<ChangeSetTab, string>;

type ViewProps = { set: ChangeSet };

/** A loaded set: sticky header with the ship actions, banners, then the four review tabs. */
export const View = ({ set }: ViewProps) => {
  const { t } = useTranslation();
  const actorLabel = useActorLabel();
  const tab = useSearch({ from: '/app/changes/$changeSetId' }).tab ?? 'changes';
  const navigate = useNavigate({ from: '/changes/$changeSetId' });
  const review = useChangeSetReview(set.id);
  const flow = useShipFlow(set, review);
  const status = CHANGE_SET_STATUS_DISPLAY[set.status];
  const editable = EDITABLE_STATUSES.has(set.status);
  const itemCount = set.entryItemCount + set.schemaItemCount;
  const meta = [
    t('changes.review.openedBy', { name: actorLabel(set.createdBy), at: formatRelativeTime(set.createdAt) }),
    t('changes.itemCount', { count: itemCount }),
    set.status === 'scheduled' && set.scheduledFor
      ? t('changes.scheduledFor', { at: formatDateTime(set.scheduledFor) })
      : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Page>
      <Tabs
        value={tab}
        onValueChange={(value) => void navigate({ search: { tab: value as ChangeSetTab }, replace: true })}
        className="gap-6"
      >
        <PageHeader
          sticky
          breadcrumb={[{ label: t('changes.title'), link: linkOptions({ to: '/changes' }) }]}
          title={set.title}
          badge={
            <>
              <StatusChip tone={status.tone} label={t(status.labelKey)} />
              {editable ? <RenamePopover set={set} /> : null}
            </>
          }
          meta={meta}
          actions={<Actions set={set} flow={flow} />}
          tabs={
            <TabsList variant="underline" aria-label={t('changes.tabs.label')}>
              {CHANGE_SET_TABS.map((key) => (
                <TabsTrigger key={key} value={key}>
                  {t(TAB_LABEL_KEYS[key])}
                </TabsTrigger>
              ))}
            </TabsList>
          }
        />
        <Banners
          set={set}
          flow={flow}
          notices={review.data?.notices ?? []}
          showAcknowledgementHint={editable && tab !== 'checks'}
        />
        <QueryView query={review} loadingRows={6}>
          {(data) => (
            <>
              <TabsContent value="changes">
                <ChangesTab review={data} editable={editable} />
              </TabsContent>
              <TabsContent value="checks">
                <ChecksTab review={data} flow={flow} />
              </TabsContent>
              <TabsContent value="consumers">
                <ConsumersTab review={data} />
              </TabsContent>
            </>
          )}
        </QueryView>
        <TabsContent value="timeline">
          <TimelineTab changeSetId={set.id} />
        </TabsContent>
      </Tabs>
    </Page>
  );
};
