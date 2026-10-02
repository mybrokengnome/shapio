import type { AdminAppUser } from '@shapio/client';
import { MailCheck, MoreHorizontal, ShieldCheck, Trash2, UserCheck, UserX } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { InlineConfirm } from '@/components/InlineConfirm';
import { StatusChip } from '@/components/StatusChip';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TableCell, TableRow } from '@/components/ui/table';
import { formatDateTime, formatRelativeTime } from '@/helpers/formatDate';
import { Person } from '../../../Person';
import { RoleBadges } from '../../../RoleBadges';
import type { ConfirmedAction } from '../../hooks/useAppUserActions';
import { RolesEditor } from '../../RolesEditor';
import { SignInMethods } from '../../SignInMethods';
import { useConfirmCopy } from './hooks/useConfirmCopy';

type RowProps = {
  user: AdminAppUser;
  roleNames: ReadonlyMap<string, string>;
  onResendConfirmation: (user: AdminAppUser) => void;
  /** Resolves once the action is done (the confirmation waits for it). */
  onConfirmed: (action: ConfirmedAction, user: AdminAppUser) => Promise<unknown>;
};

/**
 * One app user. Its menu hands off to a roles checklist anchored to the Roles cell, or to an inline
 * confirmation (block, unblock, delete) anchored to the menu button.
 */
export const Row = ({ user, roleNames, onResendConfirmation, onConfirmed }: RowProps) => {
  const { t } = useTranslation();
  // Undefined until first opened, so rows that are never edited don't each hold a form.
  const [editingRoles, setEditingRoles] = useState<boolean | undefined>(undefined);
  // The last action asked about stays while the confirmation animates out, so its text doesn't flicker.
  const [action, setAction] = useState<ConfirmedAction>('remove');
  const [confirming, setConfirming] = useState(false);
  const displayName = user.name || user.email;
  const copy = useConfirmCopy(action, displayName);
  const ask = (next: ConfirmedAction) => {
    setAction(next);
    setConfirming(true);
  };
  const roles = (
    <span className="flex flex-wrap gap-1">
      {user.roleIds.length === 0 ? (
        <span className="text-meta text-muted-foreground">{t('appUsers.authenticatedOnly')}</span>
      ) : (
        <RoleBadges roleIds={user.roleIds} roleNames={roleNames} />
      )}
    </span>
  );
  return (
    <TableRow>
      <TableCell>
        <Person name={displayName} email={user.email} />
      </TableCell>
      <TableCell>
        <SignInMethods user={user} />
      </TableCell>
      <TableCell>
        {editingRoles === undefined ? (
          roles
        ) : (
          <RolesEditor open={editingRoles} onOpenChange={setEditingRoles} user={user}>
            {roles}
          </RolesEditor>
        )}
      </TableCell>
      <TableCell>
        <span className="flex flex-wrap gap-1">
          {user.blocked ? (
            <StatusChip tone="danger" label={t('appUsers.blocked')} />
          ) : (
            <StatusChip tone="success" label={t('appUsers.active')} />
          )}
          {user.confirmed ? null : <StatusChip tone="warning" label={t('appUsers.unconfirmed')} />}
        </span>
      </TableCell>
      <TableCell title={formatDateTime(user.lastLoginAt) || undefined}>
        {user.lastLoginAt ? formatRelativeTime(user.lastLoginAt) : t('common.never')}
      </TableCell>
      <TableCell className="text-right">
        <DropdownMenu>
          <InlineConfirm
            {...copy}
            open={confirming}
            onOpenChange={setConfirming}
            onConfirm={() => onConfirmed(action, user)}
          >
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`${t('common.actions')}: ${displayName}`}>
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
          </InlineConfirm>
          <DropdownMenuContent
            align="end"
            onCloseAutoFocus={(event) => (confirming || editingRoles) && event.preventDefault()}
          >
            <DropdownMenuItem onSelect={() => setEditingRoles(true)}>
              <ShieldCheck aria-hidden="true" />
              {t('appUsers.editRoles')}
            </DropdownMenuItem>
            {user.confirmed ? null : (
              <DropdownMenuItem onSelect={() => onResendConfirmation(user)}>
                <MailCheck aria-hidden="true" />
                {t('appUsers.resendConfirmation')}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => ask(user.blocked ? 'unblock' : 'block')}>
              {user.blocked ? <UserCheck aria-hidden="true" /> : <UserX aria-hidden="true" />}
              {user.blocked ? t('appUsers.unblock') : t('appUsers.block')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => ask('remove')}>
              <Trash2 aria-hidden="true" />
              {t('common.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
};
