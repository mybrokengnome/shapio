import type { WebhookDelivery } from '@shapio/client';
import { ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { StatusChip } from '@/components/StatusChip';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TableCell, TableRow } from '@/components/ui/table';
import { formatDateTime, formatRelativeTime } from '@/helpers/formatDate';
import { DELIVERY_STATUS_DISPLAY } from '../../../helpers/statusDisplay';
import { Attempt } from '../Attempt';
import { ResponseCode } from '../ResponseCode';

type DeliveryProps = {
  delivery: WebhookDelivery;
  expanded: boolean;
  onToggle: () => void;
  onRedeliver: () => void;
  redelivering: boolean;
};

const DELIVERY_COLUMNS = 7;

/** A delivery row and, when expanded, its attempt log. */
export const Delivery = ({ delivery, expanded, onToggle, onRedeliver, redelivering }: DeliveryProps) => {
  const { t } = useTranslation();
  const status = DELIVERY_STATUS_DISPLAY[delivery.status];
  const detailsId = `delivery-${delivery.id}`;
  return (
    <>
      <TableRow>
        <TableCell className="w-10">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-expanded={expanded}
            aria-controls={expanded ? detailsId : undefined}
            aria-label={t('publishing.webhooks.toggleAttempts', { event: delivery.eventType })}
            onClick={onToggle}
          >
            {expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
          </Button>
        </TableCell>
        <TableCell>
          <span className="flex items-center gap-2">
            <span className="font-mono text-xs font-semibold">{delivery.eventType}</span>
            {delivery.isTest ? <Badge variant="outline">{t('publishing.webhooks.testBadge')}</Badge> : null}
          </span>
        </TableCell>
        <TableCell>
          <StatusChip tone={status.tone} label={t(status.labelKey)} />
        </TableCell>
        <TableCell>
          {delivery.lastResponseStatus === null ? (
            <span className="text-muted-foreground">{t('common.none')}</span>
          ) : (
            <ResponseCode status={delivery.lastResponseStatus} />
          )}
        </TableCell>
        <TableCell className="text-right tabular-nums">{delivery.attempts}</TableCell>
        <TableCell className="whitespace-nowrap" title={formatDateTime(delivery.createdAt)}>
          {formatRelativeTime(delivery.createdAt)}
        </TableCell>
        <TableCell className="text-right">
          <Button
            variant="ghost"
            size="sm"
            disabled={redelivering}
            aria-label={t('publishing.webhooks.redeliverLabel', { event: delivery.eventType })}
            onClick={onRedeliver}
          >
            <RotateCcw aria-hidden="true" />
            {t('publishing.webhooks.redeliver')}
          </Button>
        </TableCell>
      </TableRow>
      {expanded ? (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={DELIVERY_COLUMNS} className="bg-muted/40 whitespace-normal">
            <div id={detailsId} className="space-y-3 py-2">
              {delivery.lastError ? (
                <p className="text-meta text-destructive">
                  {t('publishing.webhooks.lastErrorValue', { error: delivery.lastError })}
                </p>
              ) : null}
              {delivery.attemptLog.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('publishing.webhooks.noAttempts')}</p>
              ) : (
                <ol className="space-y-3">
                  {delivery.attemptLog.map((attempt) => (
                    <Attempt key={attempt.attempt} attempt={attempt} />
                  ))}
                </ol>
              )}
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
};
