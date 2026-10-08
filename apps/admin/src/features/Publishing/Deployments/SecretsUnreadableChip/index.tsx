import { useTranslation } from 'react-i18next';
import { StatusChip } from '@/components/StatusChip';

type SecretsUnreadableChipProps = { unreadable: boolean };

/** Warns that a connection's stored secret can't be decrypted (the server's key changed) until it is entered again. */
export const SecretsUnreadableChip = ({ unreadable }: SecretsUnreadableChipProps) => {
  const { t } = useTranslation();
  return unreadable ? (
    <StatusChip tone="warning" label={t('publishing.deployments.secretsUnreadable')} />
  ) : null;
};
