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
