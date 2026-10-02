import type { AdminSession } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { InlineConfirm } from '@/components/InlineConfirm';
import { RowTitle } from '@/components/RowTitle';
import { TableCard } from '@/components/TableCard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table as TableRoot,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { describeUserAgent } from '@/helpers/describeUserAgent';
import { formatDateTime, formatRelativeTime } from '@/helpers/formatDate';

type TableProps = {
  sessions: readonly AdminSession[];
  /** Resolves once the session is revoked (the confirmation waits for it). */
  onRevoke: (session: AdminSession) => Promise<unknown>;
};

export const Table = ({ sessions, onRevoke }: TableProps) => {
  const { t } = useTranslation();
  return (
    <TableCard>
      <TableRoot>
        <TableHeader>
          <TableRow>
            <TableHead>{t('sessions.device')}</TableHead>
            <TableHead>{t('sessions.ipAddress')}</TableHead>
            <TableHead>{t('sessions.signedIn')}</TableHead>
            <TableHead>{t('sessions.lastActive')}</TableHead>
            <TableHead>
              <span className="sr-only">{t('common.actions')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sessions.map((session) => (
            <TableRow key={session.id}>
              <TableCell>
                <span className="flex items-center gap-2">
                  <RowTitle>{describeUserAgent(session.userAgent) ?? t('sessions.unknownDevice')}</RowTitle>
                  {session.current ? <Badge variant="secondary">{t('sessions.current')}</Badge> : null}
                </span>
              </TableCell>
              <TableCell className="font-mono text-xs">{session.ip ?? t('common.unknown')}</TableCell>
              <TableCell title={formatDateTime(session.createdAt)}>
                {formatRelativeTime(session.createdAt)}
              </TableCell>
              <TableCell title={formatDateTime(session.lastSeenAt)}>
                {formatRelativeTime(session.lastSeenAt)}
              </TableCell>
              <TableCell className="text-right">
                {session.current ? null : (
                  <InlineConfirm
                    tone="danger"
                    title={t('sessions.revokeTitle')}
                    description={t('sessions.revokeDescription')}
                    confirmLabel={t('common.revoke')}
                    onConfirm={() => onRevoke(session)}
                    trigger={
                      <Button variant="outline" size="sm">
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
