import type { ApiToken } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { InlineConfirm } from '@/components/InlineConfirm';
import { RowTitle } from '@/components/RowTitle';
import { StatusChip } from '@/components/StatusChip';
import { TableCard } from '@/components/TableCard';
import { Button } from '@/components/ui/button';
import {
  Table as TableRoot,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDateTime, formatRelativeTime } from '@/helpers/formatDate';

type TableProps = {
  tokens: ApiToken[];
  roleNames: ReadonlyMap<string, string>;
  /** Resolves once the token is revoked (the confirmation waits for it). */
  onRevoke: (token: ApiToken) => Promise<unknown>;
};

export const Table = ({ tokens, roleNames, onRevoke }: TableProps) => {
  const { t } = useTranslation();
  return (
    <TableCard>
      <TableRoot>
        <TableHeader>
          <TableRow>
            <TableHead>{t('apiTokens.name')}</TableHead>
            <TableHead>{t('apiTokens.prefix')}</TableHead>
            <TableHead>{t('apiTokens.role')}</TableHead>
            <TableHead>{t('apiTokens.status')}</TableHead>
            <TableHead>{t('apiTokens.lastUsed')}</TableHead>
            <TableHead>{t('apiTokens.expires')}</TableHead>
            <TableHead>
              <span className="sr-only">{t('common.actions')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tokens.map((token) => (
            <TableRow key={token.id}>
              <TableCell>
                <RowTitle>{token.name}</RowTitle>
              </TableCell>
              <TableCell className="font-mono text-xs">{`${token.tokenPrefix}…`}</TableCell>
              <TableCell>{roleNames.get(token.roleId) ?? t('common.unknown')}</TableCell>
              <TableCell>
                {token.revokedAt ? (
                  <StatusChip tone="muted" label={t('apiTokens.revokedBadge')} />
                ) : (
                  <StatusChip tone="success" label={t('apiTokens.active')} />
                )}
              </TableCell>
              <TableCell title={formatDateTime(token.lastUsedAt) || undefined}>
                {token.lastUsedAt ? formatRelativeTime(token.lastUsedAt) : t('common.never')}
              </TableCell>
              <TableCell>{token.expiresAt ? formatDateTime(token.expiresAt) : t('common.never')}</TableCell>
              <TableCell className="text-right">
                {token.revokedAt ? null : (
                  <InlineConfirm
                    tone="danger"
                    title={t('apiTokens.revokeTitle', { name: token.name })}
                    description={t('apiTokens.revokeDescription')}
                    confirmLabel={t('common.revoke')}
                    onConfirm={() => onRevoke(token)}
                    trigger={
                      <Button variant="outline" size="sm" aria-label={`${t('common.revoke')}: ${token.name}`}>
                        {t('common.revoke')}
                      </Button>
                    }
                  />
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </TableRoot>
    </TableCard>
  );
};
