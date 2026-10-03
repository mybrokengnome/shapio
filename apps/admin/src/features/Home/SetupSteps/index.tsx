import { KeyRound, UserPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useHasGlobalPermission } from '@/api/auth';
import { useApiTokens } from '@/api/tokens';
import { useInvitations, useUsers } from '@/api/users';
import { NextStep } from '../NextStep';

/** Until a second admin exists or is invited. Mounted only for admins who manage users. */
const InviteStep = () => {
  const { t } = useTranslation();
  const users = useUsers();
  const invitations = useInvitations();
  const alone = users.data !== undefined && users.data.length <= 1 && invitations.data?.length === 0;
  return alone ? (
    <NextStep
      to="/network/users"
      icon={UserPlus}
      title={t('home.inviteTeam')}
      description={t('home.inviteTeamDescription')}
    />
  ) : null;
};

/** Until a working API token exists. Mounted only for admins who manage tokens. */
const TokenStep = () => {
  const { t } = useTranslation();
  const tokens = useApiTokens();
  const none = tokens.data !== undefined && tokens.data.every((token) => token.revokedAt !== null);
  return none ? (
    <NextStep
      to="/settings/api-tokens"
      icon={KeyRound}
      title={t('home.createToken')}
      description={t('home.createTokenDescription')}
    />
  ) : null;
};

/** Setup cards that disappear once done; the row collapses when none is left. */
export const SetupSteps = () => {
  const canInvite = useHasGlobalPermission('users.manage');
  const canCreateTokens = useHasGlobalPermission('tokens.manage');
  return (
    <div className="grid gap-4 empty:hidden md:grid-cols-2">
      {canInvite ? <InviteStep /> : null}
      {canCreateTokens ? <TokenStep /> : null}
    </div>
  );
};
