import type { NetworkAction } from '@shapio/client';
import type { QueryClient } from '@tanstack/react-query';
import { redirect } from '@tanstack/react-router';
import { meQueryOptions } from '@/api/auth';
import { canSeeNetwork } from '@/helpers/sites';

/** The network view is for admins holding a network action; anyone else goes home (the API refuses anyway). */
export const requireNetworkView = async (queryClient: QueryClient) => {
  const me = await queryClient.ensureQueryData(meQueryOptions);
  if (!canSeeNetwork(me)) {
    throw redirect({ to: '/', replace: true });
  }
};

/** A network page for one network action: without it, back to the network view's first page. */
export const requireNetworkPermission = async (queryClient: QueryClient, action: NetworkAction) => {
  const me = await queryClient.ensureQueryData(meQueryOptions);
  if (!me?.networkPermissions.includes(action)) {
    throw redirect({ to: '/network', replace: true });
  }
};
