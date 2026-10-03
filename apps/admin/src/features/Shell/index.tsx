import { useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useMe } from '@/api/auth';
import { hasSiteRole } from '@/helpers/sites';
import { Frame } from './Frame';
import { useIsNetworkView } from './hooks/useIsNetworkView';
import { Navigated } from './Navigated';
import { NoSiteAccess } from './NoSiteAccess';

/**
 * Signed-in frame: sidebar, the current screen, the status bar and the ⌘K palette. No desktop top bar
 * (DESIGN.md): below lg a 48px row holds the sidebar trigger. Leaves for sign-in when the session ends. On a
 * site the admin holds no role on, only the site switcher and a page saying so (nothing of the site loads).
 */
export const Shell = () => {
  const { data: me } = useMe();
  const router = useRouter();
  const isNetworkView = useIsNetworkView();
  // The session ended (sign-out, expiry, revoked elsewhere): re-run the route guard, which sends the
  // visitor to sign in and remembers where they were.
  useEffect(() => {
    if (me === null) {
      void router.invalidate();
    }
  }, [me, router]);
  if (!me) {
    return null;
  }
  if (!isNetworkView && !hasSiteRole(me)) {
    return (
      <Frame groups={[]} activeKey={undefined} section={undefined} searchable={false}>
        <NoSiteAccess />
      </Frame>
    );
  }
  return <Navigated />;
};
