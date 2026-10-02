/** Job types of package H (handlers in publishing/jobs.ts). */
export const PUBLISHING_JOBS = {
  scheduledPublication: 'publishing.scheduled',
  /** Ships a change set: a scheduled set at its time, or the prerequisites of an interactive ship. */
  changeSetShip: 'changeSet.ship',
  webhookDeliver: 'webhook.deliver',
  deploymentTrigger: 'deployment.trigger',
  deploymentPoll: 'deployment.poll',
} as const;

/** Change set events (also in the webhook catalogue). `shipped` carries the snapshot it went live in. */
export const CHANGE_SET_EVENTS = {
  scheduled: 'change_set.scheduled',
  shipping: 'change_set.shipping',
  shipped: 'change_set.shipped',
  failed: 'change_set.failed',
  discarded: 'change_set.discarded',
} as const;

/** A restore change set holds at most this many items (it ships in one transaction). */
export const RESTORE_MAX_ITEMS = 5000;
/** Usage window the change set review reports consumers over. */
export const REVIEW_USAGE_DAYS = 7;

export const DEPLOYMENT_EVENTS = {
  triggered: 'deployment.triggered',
  building: 'deployment.building',
  deployed: 'deployment.deployed',
  failed: 'deployment.failed',
} as const;

/** Attempts for scheduled publications and change sets (transient failures: schema changed, database errors). */
export const PUBLICATION_JOB_MAX_ATTEMPTS = 5;
/** Preview tokens: default and maximum lifetime. */
export const PREVIEW_TOKEN_DEFAULT_TTL_SECONDS = 60 * 60;
export const PREVIEW_TOKEN_MAX_TTL_SECONDS = 30 * 24 * 60 * 60;
export const PREVIEW_TOKEN_PREFIX = 'shpv_';
/** Webhook delivery log: response body kept per attempt. */
export const DELIVERY_BODY_LIMIT = 2048;
/** Cloudflare Pages status polling: interval and how long before a run is reported as unknown. */
export const PROVIDER_POLL_INTERVAL_MS = 15_000;
export const PROVIDER_POLL_MAX_MS = 60 * 60 * 1000;
