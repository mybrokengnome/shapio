import { Trans } from 'react-i18next';
import { TextLink } from '@/components/TextLink';
import { useNetworkPermission } from '@/features/Network/hooks/useNetworkPermission';

/**
 * Points people who came here for editors and admins to Team (admin users, in the network view). Shown only
 * to admins who can open it, the same rule as the sidebar's Team item.
 */
export const TeamHint = () => {
  const canManageTeam = useNetworkPermission('users.manage');
  if (!canManageTeam) {
    return null;
  }
  return (
    <p className="max-w-md text-sm text-muted-foreground">
      <Trans i18nKey="appUsers.teamHint" components={{ teamLink: <TextLink to="/network/users" /> }} />
    </p>
  );
};
