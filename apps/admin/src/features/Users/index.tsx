import type { AdminUser } from '@shapio/client';
import { UserPlus, Users as UsersIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useMe } from '@/api/auth';
import { useRoleNames } from '@/api/roles';
import { useSiteNames } from '@/api/sites';
import { useRemoveUser, useSetUserStatus, useUsers } from '@/api/users';
import { EmptyState } from '@/components/EmptyState';
import { Page } from '@/components/Page';
import { PageHeader } from '@/components/PageHeader';
import { QueryView } from '@/components/QueryView';
import { Button } from '@/components/ui/button';
import { useInvitationLinkReveal } from './hooks/useInvitationLinkReveal';
import { InvitationLink } from './InvitationLink';
import { Invitations } from './Invitations';
import { InviteSheet } from './InviteSheet';
import { Table } from './Table';

/** Network → Users: the admins who sign in to this instance, where each works, and invitations. */
export const Users = () => {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const users = useUsers();
  const { names: roleNames } = useRoleNames();
  const { names: siteNames } = useSiteNames();
  const setStatus = useSetUserStatus();
  const removeUser = useRemoveUser();
  const [inviting, setInviting] = useState(false);
  const invitationLink = useInvitationLinkReveal();
  const remove = async (user: AdminUser) => {
    await removeUser.mutateAsync(user.id);
    toast.success(t('users.removed'));
  };
  return (
    <Page>
      <PageHeader
        title={t('users.title')}
        actions={
          <Button onClick={() => setInviting(true)}>
            <UserPlus aria-hidden="true" />
            {t('users.invite')}
          </Button>
        }
      />
      <QueryView
        query={users}
        isEmpty={(data) => data.length === 0}
        empty={<EmptyState icon={UsersIcon} title={t('users.empty')} />}
      >
        {(data) => (
          <Table
            users={data}
            roleNames={roleNames}
            siteNames={siteNames}
            currentUserId={me?.user.id}
            onToggleStatus={(user) =>
              setStatus.mutate(
                { id: user.id, status: user.status === 'active' ? 'disabled' : 'active' },
                { onSuccess: () => toast.success(t('users.statusChanged')) },
              )
            }
            onRemove={remove}
          />
        )}
      </QueryView>
      {invitationLink.revealed ? (
        <InvitationLink
          key={invitationLink.revealed.acceptUrl}
          link={invitationLink.revealed}
          emailDelivery={invitationLink.emailDelivery}
          onDismiss={invitationLink.dismiss}
        />
      ) : null}
      <Invitations
        siteNames={siteNames}
        onCopyLink={invitationLink.reveal}
        onCloseAutoFocus={invitationLink.keepFocusOnReveal}
      />
      <InviteSheet
        open={inviting}
        onOpenChange={setInviting}
        onInvited={invitationLink.announceInvitation}
        onCloseAutoFocus={invitationLink.keepFocusOnReveal}
      />
    </Page>
  );
};
