import { useTranslation } from 'react-i18next';
import { useHasGlobalPermission, useMe } from '@/api/auth';
import { useDefinitions } from '@/api/schema';
import { LoadingState } from '@/components/LoadingState';
import { Page } from '@/components/Page';
import { PageHeader } from '@/components/PageHeader';
import { Dashboard } from '@/features/Home';
import { useModelSummaries } from '@/features/Home/hooks/useModelSummaries';
import { Stats } from '@/features/Home/Stats';
import { usePlaces } from '@/features/Shell/hooks/usePlaces';
import { GetStarted } from './GetStarted';
import { useFindingGroups } from './hooks/useFindingGroups';
import { NeedsYou } from './NeedsYou';
import { RecentlyPublished } from './RecentlyPublished';
import { ScheduledSoon } from './ScheduledSoon';

type ContentInboxProps = {
  isAdmin: boolean;
  canSeeSchedules: boolean;
  findingGroups: ReturnType<typeof useFindingGroups>;
};

/** A workspace with content: what needs you, what goes live soon, what went live lately. */
const ContentInbox = ({ isAdmin, canSeeSchedules, findingGroups }: ContentInboxProps) => {
  const needsYou = <NeedsYou {...findingGroups} />;
  // Editors: what needs them beside what went live. Admins: everything full width, side lists paired.
  return isAdmin ? (
    <>
      {needsYou}
      <div className="grid items-start gap-6 lg:grid-cols-2">
        {canSeeSchedules ? <ScheduledSoon /> : null}
        <RecentlyPublished />
      </div>
      <Dashboard />
    </>
  ) : (
    <div className="grid items-start gap-6 xl:grid-cols-3">
      <div className="min-w-0 xl:col-span-2">{needsYou}</div>
      <div className="min-w-0">
        <RecentlyPublished />
      </div>
    </div>
  );
};

/**
 * `/`, home for everyone. An empty workspace (no content types yet) shows only the steps to get started;
 * otherwise the content inbox. Admins who run publishing or the team get the workspace numbers on top and
 * the rest of the dashboard underneath.
 */
export const Inbox = () => {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const definitions = useDefinitions('model');
  const places = usePlaces();
  const { models } = useModelSummaries();
  const findingGroups = useFindingGroups();
  const canSeeSchedules = useHasGlobalPermission('publishing.manage');
  const canManageUsers = useHasGlobalPermission('users.manage');
  const isAdmin = canSeeSchedules || canManageUsers;
  const name = me?.user.name;
  // A registry that fails to load is not "empty": the content inbox shows its own errors.
  const empty = definitions.data?.length === 0;
  const { total } = findingGroups;
  const meta =
    empty || total === undefined
      ? undefined
      : total === 0
        ? t('inbox.metaClear')
        : t('inbox.meta', { count: total });
  return (
    <Page>
      <PageHeader title={name ? t('inbox.title', { name }) : t('inbox.titleFallback')} meta={meta} />
      {isAdmin ? <Stats modelCount={models?.length} /> : null}
      {definitions.isPending || (empty && places === undefined) ? (
        <LoadingState rows={3} />
      ) : empty ? (
        <GetStarted places={places ?? []} />
      ) : (
        <ContentInbox isAdmin={isAdmin} canSeeSchedules={canSeeSchedules} findingGroups={findingGroups} />
      )}
    </Page>
  );
};
