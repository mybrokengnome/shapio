import { useNavigate, useSearch } from '@tanstack/react-router';
import { Inbox } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useRedeliverWebhook, useWebhookDeliveries } from '@/api/webhooks';
import { CursorPager } from '@/components/CursorPager';
import { EmptyState } from '@/components/EmptyState';
import { Panel } from '@/components/Panel';
import { QueryView } from '@/components/QueryView';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCursorPager } from '../../../hooks/useCursorPager';
import { Delivery } from '../Delivery';

type DeliveriesProps = { webhookId: string };

/** The delivery log, newest first, polled while deliveries are still being attempted. */
export const Deliveries = ({ webhookId }: DeliveriesProps) => {
  const { t } = useTranslation();
  const { cursor } = useSearch({ from: '/app/publishing/webhooks/$webhookId' });
  const navigate = useNavigate({ from: '/publishing/webhooks/$webhookId' });
  const { pagerProps } = useCursorPager(cursor, (next) => void navigate({ search: { cursor: next } }));
  const deliveries = useWebhookDeliveries(webhookId, cursor);
  const redeliver = useRedeliverWebhook();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });
  return (
    <Panel title={t('publishing.webhooks.deliveries')} flush>
      <QueryView
        query={deliveries}
        isEmpty={(data) => data.items.length === 0 && cursor === undefined}
        empty={<EmptyState icon={Inbox} size="panel" title={t('publishing.webhooks.noDeliveries')} />}
      >
        {(data) => (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">
                    <span className="sr-only">{t('publishing.webhooks.attemptLog')}</span>
                  </TableHead>
                  <TableHead>{t('publishing.webhooks.eventType')}</TableHead>
                  <TableHead>{t('publishing.fields.status')}</TableHead>
                  <TableHead>{t('publishing.webhooks.lastResponse')}</TableHead>
                  <TableHead className="text-right">{t('publishing.webhooks.attempts')}</TableHead>
                  <TableHead>{t('publishing.fields.created')}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t('common.actions')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((delivery) => (
                  <Delivery
                    key={delivery.id}
                    delivery={delivery}
                    expanded={expanded.has(delivery.id)}
                    onToggle={() => toggle(delivery.id)}
                    redelivering={redeliver.isPending}
                    onRedeliver={() =>
                      redeliver.mutate(
                        { id: webhookId, deliveryId: delivery.id },
                        { onSuccess: () => toast.success(t('publishing.webhooks.redelivered')) },
                      )
                    }
                  />
                ))}
              </TableBody>
            </Table>
            <CursorPager {...pagerProps(data.nextCursor)} className="border-t px-4 py-2.5" />
          </>
        )}
      </QueryView>
    </Panel>
  );
};
