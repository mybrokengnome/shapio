import type { ChangeSet } from '@shapio/client';
import { useNavigate } from '@tanstack/react-router';
import { CalendarX, Loader2, Send, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useDiscardChangeSet, useUnscheduleChangeSet } from '@/api/changeSets';
import { useDeploymentConnections } from '@/api/deployments';
import { InlineConfirm } from '@/components/InlineConfirm';
import { Button } from '@/components/ui/button';
import { EDITABLE_STATUSES } from '../../Changes/constants';
import { DeployPopover } from '../DeployPopover';
import type { ShipFlow } from '../hooks/useShipFlow';
import { SchedulePopover } from '../SchedulePopover';

type ActionsProps = { set: ChangeSet; flow: ShipFlow };

/** Discard, Schedule…, Ship with deploy and Ship (primary, last); each confirmed where it was asked for. */
export const Actions = ({ set, flow }: ActionsProps) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const discard = useDiscardChangeSet();
  const unschedule = useUnscheduleChangeSet();
  const connections = useDeploymentConnections();
  const enabledConnections = (connections.data ?? []).filter((connection) => connection.enabled);
  const editable = EDITABLE_STATUSES.has(set.status);
  const shipDisabled = !flow.canShip || !flow.acknowledged || flow.shipping;
  const itemCount = set.entryItemCount + set.schemaItemCount;
  if (set.status === 'shipped' || set.status === 'discarded' || set.status === 'shipping') {
    return null;
  }
  return (
    <>
      <InlineConfirm
        tone="danger"
        title={t('changes.review.discardTitle', { title: set.title })}
        description={t('changes.review.discardDescription')}
        confirmLabel={t('changes.review.discard')}
        onConfirm={() =>
          discard.mutateAsync(set.id, {
            onSuccess: () => {
              toast.success(t('changes.review.discarded'));
              void navigate({ to: '/changes' });
            },
          })
        }
        trigger={
          <Button variant="destructive-ghost" disabled={flow.shipping}>
            <Trash2 aria-hidden="true" />
            {t('changes.review.discard')}
          </Button>
        }
      />
      {set.status === 'scheduled' ? (
        <Button
          variant="outline"
          disabled={unschedule.isPending}
          onClick={() =>
            unschedule.mutate(set.id, { onSuccess: () => toast.success(t('changes.review.unscheduled')) })
          }
        >
          <CalendarX aria-hidden="true" />
          {t('changes.review.unschedule')}
        </Button>
      ) : null}
      {editable ? (
        <>
          <SchedulePopover flow={flow} disabled={shipDisabled} />
          {enabledConnections.length > 0 ? (
            <DeployPopover
              flow={flow}
              connections={enabledConnections}
              currentConnectionId={set.deploymentConnectionId}
              disabled={shipDisabled}
            />
          ) : null}
          <InlineConfirm
            tone="default"
            title={t('changes.review.shipTitle', { title: set.title })}
            description={t('changes.review.shipDescription', { count: itemCount })}
            confirmLabel={t('changes.review.ship')}
            pendingLabel={t('changes.review.shipping')}
            onConfirm={() => flow.shipNow()}
            trigger={
              <Button disabled={shipDisabled} aria-busy={flow.shipping || undefined}>
                {flow.shipping ? (
                  <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
                ) : (
                  <Send aria-hidden="true" />
                )}
                {flow.shipping ? t('changes.review.shipping') : t('changes.review.ship')}
              </Button>
            }
          />
        </>
      ) : null}
    </>
  );
};
