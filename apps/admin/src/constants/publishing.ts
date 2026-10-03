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

/** Preview tokens last an hour: the preview pane replaces its token this long before it expires. */
export const PREVIEW_TOKEN_REFRESH_MARGIN_MS = 5 * 60_000;

/** How long the preview pane waits for the site's `shapio:ready` before saying @shapio/visual is missing. */
export const PREVIEW_READY_TIMEOUT_MS = 4_000;

/** Saves settle into one refresh of the preview frame after this quiet period. */
export const PREVIEW_REFRESH_DEBOUNCE_MS = 400;

/** The visual-editing guide (setup per starter, the attribute helper, CSP). */
export const VISUAL_EDITING_DOCS_URL =
  'https://github.com/mybrokengnome/shapio/blob/main/documentation/visual-editing.md';
