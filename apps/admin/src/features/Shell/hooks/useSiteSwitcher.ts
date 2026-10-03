import type { SiteSummary } from '@shapio/client';
import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { useMe } from '@/api/auth';
import { goToSite } from '@/app/currentSite';
import { canSeeNetwork } from '@/helpers/sites';
import { useIsNetworkView } from './useIsNetworkView';

/**
 * The site switcher's data and actions. Opening another site is a full navigation (a fresh query cache);
 * the network view and this site's own pages share the page load, so they are ordinary route changes.
 */
export const useSiteSwitcher = () => {
  const { data: me } = useMe();
  const navigate = useNavigate();
  const isNetworkView = useIsNetworkView();
  const site = me?.site;
  const openSite = useCallback(
    (target: SiteSummary) => {
      if (target.id === site?.id) {
        void navigate({ to: '/' });
        return;
      }
      goToSite(target.key);
    },
    [navigate, site?.id],
  );
  const openNetwork = useCallback(() => void navigate({ to: '/network' }), [navigate]);
  return {
    site,
    sites: me?.sites ?? [],
    isNetworkView,
    showNetwork: canSeeNetwork(me),
    openSite,
    openNetwork,
  };
};
