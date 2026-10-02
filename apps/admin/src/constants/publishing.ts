import type { DeploymentRunStatus, WebhookDeliveryStatus } from '@shapio/client';

/** How often runs and deliveries that are still in progress are polled for their outcome. */
export const PUBLISHING_POLL_INTERVAL_MS = 3_000;

/** Page size of the cursor-paginated publishing lists (jobs, schedules, runs, deliveries). */
export const PUBLISHING_PAGE_SIZE = 25;

/** A run in one of these states may still change (Shapio, a callback or the provider moves it on). */
export const ACTIVE_RUN_STATUSES: ReadonlySet<DeploymentRunStatus> = new Set([
  'queued',
  'triggered',
  'building',
]);

/** A delivery in one of these states has attempts left. */
export const ACTIVE_DELIVERY_STATUSES: ReadonlySet<WebhookDeliveryStatus> = new Set(['pending', 'retrying']);
