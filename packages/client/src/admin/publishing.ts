import type { RequestFn } from '../request.js';
import { ADMIN_PATHS, withId } from './paths.js';
import type {
  ConnectionTestResult,
  CreateDeploymentConnectionInput,
  CreatePreviewTokenInput,
  CreateScheduleInput,
  CreateWebhookInput,
  DeploymentConnection,
  DeploymentConnectionCreated,
  DeploymentRun,
  DeploymentRunQuery,
  Job,
  JobQuery,
  JobSummary,
  OpenPreviewInput,
  OpenPreviewResult,
  Page,
  PreviewToken,
  PreviewTokenCreated,
  ScheduledPublication,
  ScheduleQuery,
  UpdateDeploymentConnectionInput,
  UpdateWebhookInput,
  Webhook,
  WebhookDelivery,
  WebhookEventType,
  WebhookWithSecret,
} from './publishingTypes.js';
import { toQueryString } from './query.js';

/** Jobs, scheduled publications, webhooks, deployment connections and runs, preview (package H). */
export const createPublishingApi = (request: RequestFn) => ({
  jobs: {
    list: (query: JobQuery = {}) => request<Page<Job>>(`${ADMIN_PATHS.jobs}${toQueryString(query)}`),
    summary: () => request<JobSummary>(`${ADMIN_PATHS.jobs}/summary`),
    get: (id: string) => request<Job>(withId(ADMIN_PATHS.jobs, id)),
    /** Dead jobs only: runs again from attempt 1. 409 JOB_NOT_RETRYABLE otherwise. */
    retry: (id: string) => request<Job>(`${withId(ADMIN_PATHS.jobs, id)}/retry`, { method: 'POST' }),
  },
  schedules: {
    list: (query: ScheduleQuery = {}) =>
      request<Page<ScheduledPublication>>(`${ADMIN_PATHS.schedules}${toQueryString(query)}`),
    create: (body: CreateScheduleInput) =>
      request<ScheduledPublication>(ADMIN_PATHS.schedules, { method: 'POST', body }),
    cancel: (id: string) => request<void>(withId(ADMIN_PATHS.schedules, id), { method: 'DELETE' }),
  },
  webhooks: {
    list: () => request<Webhook[]>(ADMIN_PATHS.webhooks),
    events: async () =>
      (await request<{ items: WebhookEventType[] }>(`${ADMIN_PATHS.webhooks}/events`)).items,
    get: (id: string) => request<Webhook>(withId(ADMIN_PATHS.webhooks, id)),
    create: (body: CreateWebhookInput) =>
      request<WebhookWithSecret>(ADMIN_PATHS.webhooks, { method: 'POST', body }),
    update: (id: string, body: UpdateWebhookInput) =>
      request<Webhook>(withId(ADMIN_PATHS.webhooks, id), { method: 'PATCH', body }),
    remove: (id: string) => request<void>(withId(ADMIN_PATHS.webhooks, id), { method: 'DELETE' }),
    rotateSecret: (id: string) =>
      request<WebhookWithSecret>(`${withId(ADMIN_PATHS.webhooks, id)}/rotate-secret`, { method: 'POST' }),
    /** Queues a `webhook.test` delivery; poll the delivery log for its outcome. */
    test: (id: string) =>
      request<WebhookDelivery>(`${withId(ADMIN_PATHS.webhooks, id)}/test`, { method: 'POST' }),
    deliveries: (id: string, query: { cursor?: string; limit?: number } = {}) =>
      request<Page<WebhookDelivery>>(`${withId(ADMIN_PATHS.webhooks, id)}/deliveries${toQueryString(query)}`),
    /** Sends the same payload again as a new delivery. */
    redeliver: (id: string, deliveryId: string) =>
      request<WebhookDelivery>(
        `${withId(ADMIN_PATHS.webhooks, id)}/deliveries/${encodeURIComponent(deliveryId)}/redeliver`,
        { method: 'POST' },
      ),
  },
  deployments: {
    connections: {
      list: () => request<DeploymentConnection[]>(ADMIN_PATHS.deploymentConnections),
      get: (id: string) => request<DeploymentConnection>(withId(ADMIN_PATHS.deploymentConnections, id)),
      create: (body: CreateDeploymentConnectionInput) =>
        request<DeploymentConnectionCreated>(ADMIN_PATHS.deploymentConnections, { method: 'POST', body }),
      update: (id: string, body: UpdateDeploymentConnectionInput) =>
        request<DeploymentConnection>(withId(ADMIN_PATHS.deploymentConnections, id), {
          method: 'PATCH',
          body,
        }),
      remove: (id: string) =>
        request<void>(withId(ADMIN_PATHS.deploymentConnections, id), { method: 'DELETE' }),
      test: (id: string) =>
        request<ConnectionTestResult>(`${withId(ADMIN_PATHS.deploymentConnections, id)}/test`, {
          method: 'POST',
        }),
      /** A manual run at the current publication snapshot. */
      trigger: (id: string) =>
        request<DeploymentRun>(`${withId(ADMIN_PATHS.deploymentConnections, id)}/runs`, { method: 'POST' }),
    },
    runs: {
      list: (query: DeploymentRunQuery = {}) =>
        request<Page<DeploymentRun>>(`${ADMIN_PATHS.deploymentRuns}${toQueryString(query)}`),
      get: (id: string) => request<DeploymentRun>(withId(ADMIN_PATHS.deploymentRuns, id)),
      /** A new run (linked by `retryOf`) at the current snapshot. */
      retry: (id: string) =>
        request<DeploymentRun>(`${withId(ADMIN_PATHS.deploymentRuns, id)}/retry`, { method: 'POST' }),
    },
  },
  preview: {
    tokens: {
      list: (query: { entryId?: string } = {}) =>
        request<PreviewToken[]>(`${ADMIN_PATHS.previewTokens}${toQueryString(query)}`),
      create: (body: CreatePreviewTokenInput) =>
        request<PreviewTokenCreated>(ADMIN_PATHS.previewTokens, { method: 'POST', body }),
      revoke: (id: string) => request<void>(withId(ADMIN_PATHS.previewTokens, id), { method: 'DELETE' }),
    },
    /** The entry form's Preview action: a short-lived entry token and the rendered preview URL. */
    open: (body: OpenPreviewInput) =>
      request<OpenPreviewResult>(`${ADMIN_PATHS.preview}/open`, { method: 'POST', body }),
  },
});
