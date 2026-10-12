import type { AdminUser } from '@shapio/client';
import { MoreHorizontal, ShieldCheck, Trash2, UserCheck, UserX } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { InlineConfirm } from '@/components/InlineConfirm';
import { StatusChip } from '@/components/StatusChip';
import { Badge } from '@/components/ui/badge';
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
import { settle } from '@/helpers/settle';
import { AccessSheet } from '../../AccessSheet';
import { AssignmentBadges } from '../../AssignmentBadges';
import { useAccountConfirmKindAndCopy } from '../../hooks/useAccountConfirm';
import { Person } from '../../Person';

type RowProps = {
  user: AdminUser;
  roleNames: ReadonlyMap<string, string>;
  siteNames: ReadonlyMap<string, string>;
  isSelf: boolean;
  /** Resolves once the status is changed (a confirmation waits for it). */
  onToggleStatus: (user: AdminUser) => Promise<unknown>;
  /** Resolves once the user is removed (the confirmation waits for it). */
  onRemove: (user: AdminUser) => Promise<unknown>;
};

/**
 * One admin user. Its menu hands off to the access sheet (role per site), or to an inline confirmation
 * anchored to the menu button: for removing, and for disabling someone whose API tokens would stop working.
 */
export const Row = ({ user, roleNames, siteNames, isSelf, onToggleStatus, onRemove }: RowProps) => {
  const { t } = useTranslation();
  // Undefined until first opened, so rows that are never edited don't each hold a form.
  const [editingAccess, setEditingAccess] = useState<boolean | undefined>(undefined);
  const confirm = useAccountConfirmKindAndCopy(user);
  const displayName = user.name || user.email;
  const toggleStatus = () => {
    if (confirm.disableNeedsConfirm) {
      confirm.setKind('disable');
      return;
    }
    // A failure is reported by the mutation cache.
    void settle(onToggleStatus(user));
  };
  return (
    <TableRow>
      <TableCell>
        <Person
          name={displayName}
          email={user.email}
          badge={isSelf ? <Badge variant="secondary">{t('users.you')}</Badge> : null}
        />
      </TableCell>
      <TableCell>
        <span className="flex flex-wrap gap-1">
          <AssignmentBadges assignments={user.assignments} roleNames={roleNames} siteNames={siteNames} />
        </span>
        {editingAccess === undefined ? null : (
          <AccessSheet open={editingAccess} onOpenChange={setEditingAccess} user={user} />
        )}
      </TableCell>
      <TableCell>
        {user.status === 'active' ? (
          <StatusChip tone="success" label={t('users.active')} />
        ) : (
          <StatusChip tone="muted" label={t('users.disabled')} />
        )}
      </TableCell>
      <TableCell title={formatDateTime(user.lastLoginAt) || undefined}>
        {user.lastLoginAt ? formatRelativeTime(user.lastLoginAt) : t('common.never')}
      </TableCell>
      <TableCell className="text-right">
        {isSelf ? null : (
          <DropdownMenu>
            <InlineConfirm
              tone="danger"
              open={confirm.kind !== null}
              onOpenChange={(open) => !open && confirm.setKind(null)}
              title={confirm.copy.title}
              description={confirm.copy.description}
              confirmLabel={confirm.copy.confirmLabel}
              onConfirm={() => (confirm.kind === 'disable' ? onToggleStatus(user) : onRemove(user))}
            >
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={`${t('common.actions')}: ${displayName}`}>
                  <MoreHorizontal aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
            </InlineConfirm>
            <DropdownMenuContent
              align="end"
              onCloseAutoFocus={(event) => (confirm.kind !== null || editingAccess) && event.preventDefault()}
            >
              <DropdownMenuItem onSelect={() => setEditingAccess(true)}>
                <ShieldCheck aria-hidden="true" />
                {t('users.editAccess')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={toggleStatus}>
                {user.status === 'active' ? <UserX aria-hidden="true" /> : <UserCheck aria-hidden="true" />}
                {user.status === 'active' ? t('users.disable') : t('users.enable')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => confirm.setKind('remove')}>
                <Trash2 aria-hidden="true" />
                {t('common.remove')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </TableCell>
    </TableRow>
  );
};
