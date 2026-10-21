import type { DeploymentConnectionSummary } from '@shapio/client';
import type { UseQueryResult } from '@tanstack/react-query';
import { useDeploymentConnectionSummaries, useDeploymentConnections } from '@/api/deployments';
import { usePublishingPermissions } from '../../hooks/usePublishingPermissions';

/**
 * The connections shown as cards: managers get the full connections, admins who may only trigger get their
 * summaries (state and runs, no settings or URLs), and admins who may do neither get none (`shown` false).
 * Only the one list this admin may read is requested.
 */
export const useConnectionCards = (): {
  connections: UseQueryResult<DeploymentConnectionSummary[]>;
  shown: boolean;
} => {
  const { canManageDeployments, canTriggerDeployments } = usePublishingPermissions();
  const full = useDeploymentConnections(canManageDeployments);
  const summaries = useDeploymentConnectionSummaries(!canManageDeployments && canTriggerDeployments);
  return {
    connections: canManageDeployments ? full : summaries,
    shown: canManageDeployments || canTriggerDeployments,
  };
};
