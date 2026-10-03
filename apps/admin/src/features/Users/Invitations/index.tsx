import type { Invitation } from '@shapio/client';
import { Link } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useRoleNames } from '@/api/roles';
import { useInvitations, useRevokeInvitation } from '@/api/users';
import { ErrorState } from '@/components/ErrorState';
import { InlineConfirm } from '@/components/InlineConfirm';
import { Panel } from '@/components/Panel';
import { RowTitle } from '@/components/RowTitle';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDateTime, formatRelativeTime } from '@/helpers/formatDate';
import { AssignmentBadges } from '../AssignmentBadges';

type InvitationsProps = {
  siteNames: ReadonlyMap<string, string>;
  /** Issues a fresh link for the invitation and shows it; resolves once it is shown. */
  onCopyLink: (invitation: Invitation) => Promise<unknown>;
  /** Keeps focus on a link that just appeared instead of returning it to the row's button. */
  onCloseAutoFocus: (event: Event) => void;
};

/**
 * Invitations not yet accepted; the panel only appears while there are some. Each row can issue a new link
 * to send by hand (the earlier one stops working) or revoke the invitation.
 */
export const Invitations = ({ siteNames, onCopyLink, onCloseAutoFocus }: InvitationsProps) => {
  const { t } = useTranslation();
  const invitations = useInvitations();
  const { names: roleNames } = useRoleNames();
  const revoke = useRevokeInvitation();
  if (invitations.isError) {
    return <ErrorState error={invitations.error} onRetry={() => void invitations.refetch()} />;
  }
  if (!invitations.data || invitations.data.length === 0) {
    return null;
  }
  return (
    <Panel title={t('users.invitationsTitle')} flush>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('users.email')}</TableHead>
            <TableHead>{t('users.roles')}</TableHead>
            <TableHead>{t('users.invitationExpires')}</TableHead>
            <TableHead>
              <span className="sr-only">{t('common.actions')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invitations.data.map((invitation) => (
            <TableRow key={invitation.id}>
              <TableCell>
                <RowTitle>{invitation.email}</RowTitle>
              </TableCell>
              <TableCell>
                <span className="flex flex-wrap gap-1">
                  <AssignmentBadges
                    assignments={invitation.assignments}
                    roleNames={roleNames}
                    siteNames={siteNames}
                  />
                </span>
              </TableCell>
              <TableCell title={formatDateTime(invitation.expiresAt)}>
                {formatRelativeTime(invitation.expiresAt)}
              </TableCell>
              <TableCell>
                <div className="flex justify-end gap-2">
                  <InlineConfirm
                    tone="default"
                    title={t('users.invitationLink.confirmTitle', { email: invitation.email })}
                    description={t('users.invitationLink.confirmDescription')}
                    confirmLabel={t('users.invitationLink.create')}
                    onConfirm={() => onCopyLink(invitation)}
                    onCloseAutoFocus={onCloseAutoFocus}
                    trigger={
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={`${t('users.copyLink')}: ${invitation.email}`}
                      >
                        <Link aria-hidden="true" />
                        {t('users.copyLink')}
                      </Button>
                    }
                  />
                  <InlineConfirm
                    tone="danger"
                    title={t('users.revokeInvitationTitle', { email: invitation.email })}
                    description={t('users.revokeInvitationDescription')}
                    confirmLabel={t('common.revoke')}
                    onConfirm={async () => {
                      await revoke.mutateAsync(invitation.id);
                      toast.success(t('users.invitationRevoked'));
                    }}
                    trigger={
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={`${t('common.revoke')}: ${invitation.email}`}
                      >
                        {t('common.revoke')}
                      </Button>
                    }
                  />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Panel>
  );
};
