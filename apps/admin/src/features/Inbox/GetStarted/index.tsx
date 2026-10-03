import { linkOptions } from '@tanstack/react-router';
import { Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useHasGlobalPermission } from '@/api/auth';
import { useApiTokens } from '@/api/tokens';
import { useInvitations, useUsers } from '@/api/users';
import { EmptyState } from '@/components/EmptyState';
import { Panel } from '@/components/Panel';
import type { Place } from '@/features/Shell/hooks/usePlaces';
import { Step } from './Step';

type GetStartedProps = { places: readonly Place[] };

/** Ticked once a second admin exists or someone is invited. Mounted only for admins who manage users. */
const InviteStep = () => {
  const { t } = useTranslation();
  const users = useUsers();
  const invitations = useInvitations();
  const done = (users.data?.length ?? 0) > 1 || (invitations.data?.length ?? 0) > 0;
  return (
    <Step
      title={t('inbox.getStarted.invite.title')}
      description={t('inbox.getStarted.invite.description')}
      action={t('inbox.getStarted.invite.action')}
      link={linkOptions({ to: '/network/users' })}
      done={done}
    />
  );
};

/** Ticked once a token that still works exists. Mounted only for admins who manage tokens. */
const TokenStep = () => {
  const { t } = useTranslation();
  const tokens = useApiTokens();
  const done = tokens.data?.some((token) => token.revokedAt === null) ?? false;
  return (
    <Step
      title={t('inbox.getStarted.token.title')}
      description={t('inbox.getStarted.token.description')}
      action={t('inbox.getStarted.token.action')}
      link={linkOptions({ to: '/settings/api-tokens' })}
      done={done}
    />
  );
};

/**
 * The Inbox of an empty workspace: the few steps that make Shapio useful, in order, each with the button
 * that does it. Steps the admin can't take are left out; a step that needs an earlier one waits for it.
 */
export const GetStarted = ({ places }: GetStartedProps) => {
  const { t } = useTranslation();
  const canCreateType = useHasGlobalPermission('schema.create');
  const canInvite = useHasGlobalPermission('users.manage');
  const canCreateTokens = useHasGlobalPermission('tokens.manage');
  const firstPlace = places.find((place) => place.canCreate);
  const hasType = places.length > 0;
  const anyStep = canCreateType || Boolean(firstPlace) || canInvite || canCreateTokens;
  return (
    <Panel title={t('inbox.getStarted.title')} flush>
      {anyStep ? (
        <ol className="divide-y [counter-reset:step]">
          {canCreateType ? (
            <Step
              title={t('inbox.getStarted.type.title')}
              description={t('inbox.getStarted.type.description')}
              action={t('shell.nav.newType')}
              link={linkOptions({ to: '/content/new' })}
              done={hasType}
            />
          ) : null}
          {hasType && firstPlace ? (
            <Step
              title={t('inbox.getStarted.entry.title')}
              description={t('inbox.getStarted.entry.description', { place: firstPlace.label })}
              action={t('palette.newEntry', { name: firstPlace.label })}
              link={
                firstPlace.kind === 'collection'
                  ? linkOptions({ to: '/content/$modelKey/new', params: { modelKey: firstPlace.apiKey } })
                  : linkOptions({ to: '/content/$modelKey', params: { modelKey: firstPlace.apiKey } })
              }
              done={false}
            />
          ) : null}
          {canInvite ? <InviteStep /> : null}
          {canCreateTokens ? <TokenStep /> : null}
        </ol>
      ) : (
        <EmptyState
          compact
          icon={Sparkles}
          title={t('inbox.getStarted.waiting')}
          description={t('inbox.getStarted.waitingDescription')}
        />
      )}
    </Panel>
  );
};
