import { useTranslation } from 'react-i18next';
import { Panel } from '@/components/Panel';
import { useDevelopPermissions } from '../../Changes/hooks/useDevelopPermissions';
import { WebhooksRow } from './WebhooksRow';

/** Outgoing webhooks at a glance, linking to their Publishing section. */
export const OperationsCard = () => {
  const { t } = useTranslation();
  const { canManageWebhooks } = useDevelopPermissions();
  if (!canManageWebhooks) {
    return null;
  }
  return (
    <Panel title={t('develop.live.webhooks')}>
      <dl className="space-y-3">
        <WebhooksRow />
      </dl>
    </Panel>
  );
};
