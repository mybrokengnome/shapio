import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useWebhooks } from '@/api/webhooks';
import { StatusChip } from '@/components/StatusChip';

/** Webhooks: how many are on, and how many last gave up delivering (needs `webhooks.manage`). */
export const WebhooksRow = () => {
  const { t } = useTranslation();
  const webhooks = useWebhooks();
  if (!webhooks.data) {
    return null;
  }
  const enabled = webhooks.data.filter((webhook) => webhook.enabled);
  const failing = enabled.filter((webhook) => webhook.lastDelivery?.status === 'dead').length;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <dt>
        <Link
          to="/publishing/webhooks"
          className="text-sm font-semibold text-link underline-offset-4 hover:underline"
        >
          {t('develop.live.webhooks')}
        </Link>
      </dt>
      <dd className="flex flex-wrap gap-1.5">
        <StatusChip
          tone="success"
          label={t('develop.live.webhooksEnabled', { count: enabled.length })}
          size="sm"
        />
        <StatusChip
          tone={failing > 0 ? 'danger' : 'muted'}
          label={t('develop.live.webhooksFailing', { count: failing })}
          size="sm"
        />
      </dd>
    </div>
  );
};
