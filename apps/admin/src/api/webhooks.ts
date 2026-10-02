import type { CreateWebhookInput, UpdateWebhookInput, Webhook } from '@shapio/client';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ACTIVE_DELIVERY_STATUSES,
  PUBLISHING_PAGE_SIZE,
  PUBLISHING_POLL_INTERVAL_MS,
} from '@/constants/publishing';
import { adminApi } from './client';
import { withCsrf } from './csrf';
import { queryKeys } from './queryKeys';

const silent = { silent: true } as const;

export const useWebhooks = () =>
  useQuery({
    queryKey: queryKeys.publishing.webhooks.list,
    queryFn: () => adminApi.webhooks.list(),
    meta: silent,
  });

/** The event types a webhook can subscribe to (a fixed catalogue: cached for the session). */
export const useWebhookEvents = () =>
  useQuery({
    queryKey: queryKeys.publishing.webhooks.events,
    queryFn: () => adminApi.webhooks.events(),
    staleTime: Infinity,
    meta: silent,
  });

export const useWebhook = (id: string) =>
  useQuery({
    queryKey: queryKeys.publishing.webhooks.webhook(id),
    queryFn: () => adminApi.webhooks.get(id),
    meta: silent,
  });

/** One page of the delivery log, polled while a delivery on it still has attempts left. */
export const useWebhookDeliveries = (id: string, cursor: string | undefined) =>
  useQuery({
    queryKey: queryKeys.publishing.webhooks.deliveries(id, cursor),
    queryFn: () => adminApi.webhooks.deliveries(id, { cursor, limit: PUBLISHING_PAGE_SIZE }),
    placeholderData: keepPreviousData,
    refetchInterval: (query) =>
      query.state.data?.items.some((delivery) => ACTIVE_DELIVERY_STATUSES.has(delivery.status))
        ? PUBLISHING_POLL_INTERVAL_MS
        : false,
    meta: silent,
  });

const useInvalidateWebhooks = () => {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.publishing.webhooks.all });
};

export const useCreateWebhook = () => {
  const invalidate = useInvalidateWebhooks();
  return useMutation({
    mutationKey: ['webhooks', 'create'],
    meta: silent,
    mutationFn: (input: CreateWebhookInput) => withCsrf(() => adminApi.webhooks.create(input)),
    onSuccess: invalidate,
  });
};

/** 409 when `expectedVersion` is stale: the caller reloads and tells the user. */
export const useUpdateWebhook = () => {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateWebhooks();
  return useMutation({
    mutationKey: ['webhooks', 'update'],
    meta: silent,
    mutationFn: ({ id, input }: { id: string; input: UpdateWebhookInput }) =>
      withCsrf(() => adminApi.webhooks.update(id, input)),
    onSuccess: (webhook: Webhook) => {
      queryClient.setQueryData(queryKeys.publishing.webhooks.webhook(webhook.id), webhook);
      return invalidate();
    },
  });
};

export const useDeleteWebhook = () => {
  const invalidate = useInvalidateWebhooks();
  return useMutation({
    mutationKey: ['webhooks', 'delete'],
    mutationFn: (id: string) => withCsrf(() => adminApi.webhooks.remove(id)),
    onSuccess: invalidate,
  });
};

export const useRotateWebhookSecret = () => {
  const invalidate = useInvalidateWebhooks();
  return useMutation({
    mutationKey: ['webhooks', 'rotateSecret'],
    mutationFn: (id: string) => withCsrf(() => adminApi.webhooks.rotateSecret(id)),
    onSuccess: invalidate,
  });
};

/** Queues a `webhook.test` delivery; the delivery log shows its outcome. */
export const useTestWebhook = () => {
  const invalidate = useInvalidateWebhooks();
  return useMutation({
    mutationKey: ['webhooks', 'test'],
    mutationFn: (id: string) => withCsrf(() => adminApi.webhooks.test(id)),
    onSuccess: invalidate,
  });
};

export const useRedeliverWebhook = () => {
  const invalidate = useInvalidateWebhooks();
  return useMutation({
    mutationKey: ['webhooks', 'redeliver'],
    mutationFn: ({ id, deliveryId }: { id: string; deliveryId: string }) =>
      withCsrf(() => adminApi.webhooks.redeliver(id, deliveryId)),
    onSuccess: invalidate,
  });
};
