import type {
  CreateDeploymentConnectionInput,
  DeploymentConnection,
  DeploymentRunQuery,
  UpdateDeploymentConnectionInput,
} from '@shapio/client';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ACTIVE_RUN_STATUSES, PUBLISHING_POLL_INTERVAL_MS } from '@/constants/publishing';
import { adminApi } from './client';
import { withCsrf } from './csrf';
import { queryKeys } from './queryKeys';

const silent = { silent: true } as const;

/** Polls while the latest runs are still in progress, so statuses move on screen without a reload. */
const pollWhileActive = (active: boolean) => (active ? PUBLISHING_POLL_INTERVAL_MS : false);

export const useDeploymentConnections = () =>
  useQuery({
    queryKey: queryKeys.publishing.deployments.connections,
    queryFn: () => adminApi.deployments.connections.list(),
    refetchInterval: (query) =>
      pollWhileActive(
        query.state.data?.some((connection) =>
          connection.latestRun ? ACTIVE_RUN_STATUSES.has(connection.latestRun.status) : false,
        ) ?? false,
      ),
    meta: silent,
  });

export const useDeploymentConnection = (id: string) =>
  useQuery({
    queryKey: queryKeys.publishing.deployments.connection(id),
    queryFn: () => adminApi.deployments.connections.get(id),
    refetchInterval: (query) =>
      pollWhileActive(
        query.state.data?.latestRun ? ACTIVE_RUN_STATUSES.has(query.state.data.latestRun.status) : false,
      ),
    meta: silent,
  });

export const useDeploymentRuns = (query: DeploymentRunQuery) =>
  useQuery({
    queryKey: queryKeys.publishing.deployments.runs(query),
    queryFn: () => adminApi.deployments.runs.list(query),
    placeholderData: keepPreviousData,
    refetchInterval: (state) =>
      pollWhileActive(state.state.data?.items.some((run) => ACTIVE_RUN_STATUSES.has(run.status)) ?? false),
    meta: silent,
  });

/** One run, polled until it reaches a final state (deployed, failed or unknown). */
export const useDeploymentRun = (id: string) =>
  useQuery({
    queryKey: queryKeys.publishing.deployments.run(id),
    queryFn: () => adminApi.deployments.runs.get(id),
    refetchInterval: (query) =>
      pollWhileActive(query.state.data ? ACTIVE_RUN_STATUSES.has(query.state.data.status) : false),
    meta: silent,
  });

const useInvalidateDeployments = () => {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.publishing.deployments.all });
};

export const useCreateDeploymentConnection = () => {
  const invalidate = useInvalidateDeployments();
  return useMutation({
    mutationKey: ['deployments', 'create'],
    meta: silent,
    mutationFn: (input: CreateDeploymentConnectionInput) =>
      withCsrf(() => adminApi.deployments.connections.create(input)),
    onSuccess: invalidate,
  });
};

/** 409 when `expectedVersion` is stale: the caller reloads and tells the user. */
export const useUpdateDeploymentConnection = () => {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateDeployments();
  return useMutation({
    mutationKey: ['deployments', 'update'],
    meta: silent,
    mutationFn: ({ id, input }: { id: string; input: UpdateDeploymentConnectionInput }) =>
      withCsrf(() => adminApi.deployments.connections.update(id, input)),
    onSuccess: (connection: DeploymentConnection) => {
      queryClient.setQueryData(queryKeys.publishing.deployments.connection(connection.id), connection);
      return invalidate();
    },
  });
};

export const useDeleteDeploymentConnection = () => {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateDeployments();
  return useMutation({
    mutationKey: ['deployments', 'delete'],
    mutationFn: (id: string) => withCsrf(() => adminApi.deployments.connections.remove(id)),
    onSuccess: (_result, id) => {
      queryClient.removeQueries({ queryKey: queryKeys.publishing.deployments.connection(id) });
      return invalidate();
    },
  });
};

/** Runs the provider's checks (credentials, reachability); the result is shown, not cached. */
export const useTestDeploymentConnection = () =>
  useMutation({
    mutationKey: ['deployments', 'test'],
    mutationFn: (id: string) => withCsrf(() => adminApi.deployments.connections.test(id)),
  });

export const useTriggerDeployment = () => {
  const invalidate = useInvalidateDeployments();
  return useMutation({
    mutationKey: ['deployments', 'trigger'],
    mutationFn: (id: string) => withCsrf(() => adminApi.deployments.connections.trigger(id)),
    onSuccess: invalidate,
  });
};

export const useRetryDeploymentRun = () => {
  const invalidate = useInvalidateDeployments();
  return useMutation({
    mutationKey: ['deployments', 'retry'],
    mutationFn: (id: string) => withCsrf(() => adminApi.deployments.runs.retry(id)),
    onSuccess: invalidate,
  });
};
