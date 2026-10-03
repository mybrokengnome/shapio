import type { Webhook } from '@shapio/client';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { RowTitle } from '@/components/RowTitle';
import { StatusChip } from '@/components/StatusChip';
import { TableCard } from '@/components/TableCard';
import {
  Table as TableRoot,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDateTime, formatRelativeTime } from '@/helpers/formatDate';
import { EnabledChip } from '../../EnabledChip';
import { DELIVERY_STATUS_DISPLAY } from '../../helpers/statusDisplay';
import { SiteBadge } from '../SiteBadge';

type TableProps = { webhooks: Webhook[] };

export const Table = ({ webhooks }: TableProps) => {
  const { t } = useTranslation();
  return (
    <TableCard>
      <TableRoot>
        <TableHeader>
          <TableRow>
            <TableHead>{t('publishing.webhooks.name')}</TableHead>
            <TableHead>{t('publishing.webhooks.url')}</TableHead>
            <TableHead>{t('publishing.webhooks.state')}</TableHead>
            <TableHead>{t('publishing.webhooks.lastDelivery')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {webhooks.map((webhook) => {
            const last = webhook.lastDelivery
              ? DELIVERY_STATUS_DISPLAY[webhook.lastDelivery.status]
              : undefined;
            return (
              <TableRow key={webhook.id}>
                <TableCell className="max-w-64">
                  <span className="flex min-w-0 items-center gap-2">
                    <RowTitle asChild className="block truncate">
                      <Link to="/publishing/webhooks/$webhookId" params={{ webhookId: webhook.id }}>
                        {webhook.name}
                      </Link>
                    </RowTitle>
                    <SiteBadge webhook={webhook} />
                  </span>
                </TableCell>
                <TableCell className="max-w-72">
                  <span
                    className="block truncate font-mono text-xs text-muted-foreground"
                    title={webhook.url}
                  >
                    {webhook.url}
                  </span>
                </TableCell>
                <TableCell>
                  <EnabledChip enabled={webhook.enabled} />
                </TableCell>
                <TableCell>
                  {webhook.lastDelivery && last ? (
                    <span className="flex flex-wrap items-center gap-2">
                      <StatusChip tone={last.tone} label={t(last.labelKey)} />
                      <span
                        className="text-meta whitespace-nowrap text-muted-foreground"
                        title={formatDateTime(webhook.lastDelivery.at)}
                      >
                        {formatRelativeTime(webhook.lastDelivery.at)}
                      </span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">{t('common.never')}</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </TableRoot>
    </TableCard>
  );
};
