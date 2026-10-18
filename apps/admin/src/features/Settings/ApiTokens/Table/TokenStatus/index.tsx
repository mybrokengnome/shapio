import type { ApiToken } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { StatusChip } from '@/components/StatusChip';
import { formatDate, formatDateTime } from '@/helpers/formatDate';
import { tokenStateOf } from '../../helpers/tokenState';

type TokenStatusProps = {
  token: ApiToken;
  /** The time the status is for (ms since the epoch), read once by the table. */
  now: number;
};

/**
 * Active, expiring soon (days left), expired, or paused (its creator's account is disabled, so it is refused
 * until they are enabled), with the expiry date under the chip while it still matters. The full date and
 * time are in the title.
 */
export const TokenStatus = ({ token, now }: TokenStatusProps) => {
  const { t } = useTranslation();
  const state = tokenStateOf(token, now);
  const chip =
    state.kind === 'expired' ? (
      <StatusChip tone="muted" label={t('apiTokens.expired')} />
    ) : state.kind === 'paused' ? (
      <StatusChip tone="warning" label={t('apiTokens.pausedBadge')} />
    ) : state.kind === 'expiring' ? (
      <StatusChip tone="warning" label={t('apiTokens.expiresInDays', { count: state.days })} />
    ) : (
      <StatusChip tone="success" label={t('apiTokens.active')} />
    );
  const showDate = token.expiresAt !== null && (state.kind === 'active' || state.kind === 'paused');
  return (
    <span
      className="flex flex-col items-start gap-1"
      title={token.expiresAt ? formatDateTime(token.expiresAt) : undefined}
    >
      {chip}
      {showDate ? (
        <span className="text-meta text-muted-foreground">
          {t('apiTokens.expiresOn', { date: formatDate(token.expiresAt) })}
        </span>
      ) : null}
    </span>
  );
};
