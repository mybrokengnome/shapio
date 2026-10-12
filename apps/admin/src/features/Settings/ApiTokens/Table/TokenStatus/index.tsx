import type { ApiToken } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { StatusChip } from '@/components/StatusChip';

type TokenStatusProps = { token: ApiToken };

/** Revoked, paused (its creator's account is disabled, so it is refused until they are enabled) or active. */
export const TokenStatus = ({ token }: TokenStatusProps) => {
  const { t } = useTranslation();
  if (token.revokedAt) {
    return <StatusChip tone="muted" label={t('apiTokens.revokedBadge')} />;
  }
  if (token.creatorDisabled) {
    return <StatusChip tone="warning" label={t('apiTokens.pausedBadge')} />;
  }
  return <StatusChip tone="success" label={t('apiTokens.active')} />;
};
