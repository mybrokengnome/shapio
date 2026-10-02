import type { AdminAppUser } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { Table as TableRoot, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ConfirmedAction } from '../hooks/useAppUserActions';
import { Row } from './Row';

type TableProps = {
  users: AdminAppUser[];
  roleNames: ReadonlyMap<string, string>;
  onResendConfirmation: (user: AdminAppUser) => void;
  onConfirmed: (action: ConfirmedAction, user: AdminAppUser) => Promise<unknown>;
};

export const Table = ({ users, roleNames, onResendConfirmation, onConfirmed }: TableProps) => {
  const { t } = useTranslation();
  return (
    <TableRoot>
      <TableHeader>
        <TableRow>
          <TableHead>{t('appUsers.name')}</TableHead>
          <TableHead>{t('appUsers.signIn')}</TableHead>
          <TableHead>{t('appUsers.roles')}</TableHead>
          <TableHead>{t('appUsers.status')}</TableHead>
          <TableHead>{t('appUsers.lastLogin')}</TableHead>
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
            onResendConfirmation={onResendConfirmation}
            onConfirmed={onConfirmed}
          />
        ))}
      </TableBody>
    </TableRoot>
  );
};
