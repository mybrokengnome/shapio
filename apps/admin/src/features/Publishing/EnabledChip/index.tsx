import { useTranslation } from 'react-i18next';
import { StatusChip } from '@/components/StatusChip';

type EnabledChipProps = { enabled: boolean };

/** "Enabled" / "Disabled" for webhooks and deployment connections. */
export const EnabledChip = ({ enabled }: EnabledChipProps) => {
  const { t } = useTranslation();
  return enabled ? (
    <StatusChip tone="success" label={t('publishing.enabled')} />
  ) : (
    <StatusChip tone="muted" label={t('publishing.disabled')} />
  );
};
