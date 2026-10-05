import { isModelDefinition } from '@shapio/schema';
import { getRouteApi } from '@tanstack/react-router';
import { useAllDefinitions } from '@/api/schema';
import { counterpartOperationId } from '../helpers/graphqlQuery';
import type { DeliveryOperation } from '../helpers/operations';
import type { ExplorerTab } from '../searchSchema';

const route = getRouteApi('/app/api-explorer');

/**
 * Switches between REST and GraphQL on the same endpoint: the list stays the list, the read by ID the read
 * by ID, so the GraphQL tab shows the request just built in the REST tab.
 */
export const useSwitchTab = (
  restOperations: readonly DeliveryOperation[],
  operationId: string | undefined,
) => {
  const navigate = route.useNavigate();
  const { definitions } = useAllDefinitions();
  return (tab: ExplorerTab) => {
    const models = (definitions ?? []).map(({ definition }) => definition).filter(isModelDefinition);
    const op = counterpartOperationId(tab, operationId, models, restOperations);
    void navigate({ search: { tab, ...(op ? { op } : {}) }, replace: true });
  };
};
