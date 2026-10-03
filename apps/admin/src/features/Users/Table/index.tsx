import type { AdminUser } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { TableCard } from '@/components/TableCard';
import { Table as TableRoot, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Row } from './Row';

type TableProps = {
  users: AdminUser[];
  roleNames: ReadonlyMap<string, string>;
  siteNames: ReadonlyMap<string, string>;
  currentUserId: string | undefined;
  onToggleStatus: (user: AdminUser) => void;
  onRemove: (user: AdminUser) => Promise<unknown>;
};

export const Table = ({
  users,
  roleNames,
  siteNames,
  currentUserId,
  onToggleStatus,
  onRemove,
}: TableProps) => {
  const { t } = useTranslation();
  return (
    <TableCard>
      <TableRoot>
        <TableHeader>
          <TableRow>
            <TableHead>{t('users.name')}</TableHead>
            <TableHead>{t('users.roles')}</TableHead>
            <TableHead>{t('users.status')}</TableHead>
            <TableHead>{t('users.lastLogin')}</TableHead>
            <TableHead>
              <span className="sr-only">{t('common.actions')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => (
            <Row
              key={user.id}
              user={user}
              roleNames={roleNames}
              siteNames={siteNames}
              isSelf={user.id === currentUserId}
              onToggleStatus={onToggleStatus}
              onRemove={onRemove}
            />
          ))}
        </TableBody>
      </TableRoot>
    </TableCard>
  );
};
