/**
 * Publishing types (package H, `apps/api/src/routes/admin/{jobs,publishing,webhooks,deployments,preview}`).
 * Dates are ISO-8601 strings.
 */
import type { SiteRef } from './sitesTypes.js';

export type Page<T> = { items: T[]; nextCursor: string | null };

// Jobs ---------------------------------------------------------------------------------------------

export const JOB_STATUSES = ['pending', 'running', 'succeeded', 'dead'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export type Job = {
  id: string;
  type: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  /** When it runs next (pending) or ran last. */
  runAt: string;
  idempotencyKey: string | null;
  lockedBy: string | null;
  lockedUntil: string | null;
  /** Payload and result with secret-looking values replaced by `[redacted]`. */
  payload: unknown;
  result: unknown;
  /** Progress a long job saved (e.g. an import's phase and counts); null when it saved none. */
  progress: unknown;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

export type JobQuery = { status?: JobStatus; type?: string; cursor?: string; limit?: number };

export type JobSummary = { counts: Record<JobStatus, number>; types: string[] };

// Scheduled publications ---------------------------------------------------------------------------

export const PUBLICATION_ACTIONS = ['publish', 'unpublish'] as const;
export type PublicationAction = (typeof PUBLICATION_ACTIONS)[number];

export const SCHEDULE_STATUSES = ['scheduled', 'done', 'failed', 'cancelled'] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

export type ScheduledPublication = {
  id: string;
  entryId: string;
  modelId: string;
  /** Null when the model no longer exists. */
  modelKey: string | null;
  locale: string;
  action: PublicationAction;
  runAt: string;
  status: ScheduleStatus;
  error: string | null;
  /** Publication sequence the change was published at (once done). */
  snapshot: number | null;
  createdBy: string | null;
  createdAt: string;
  executedAt: string | null;
};

export type ScheduleQuery = { status?: ScheduleStatus; entryId?: string; cursor?: string; limit?: number };

export type CreateScheduleInput = {
  modelKey: string;
  entryId: string;
  /** Omit for non-localized models (and for the default locale). */
  locale?: string;
  action: PublicationAction;
  runAt: string;
};

// Webhooks -----------------------------------------------------------------------------------------

export type WebhookEventType = { type: string; group: string };

export type WebhookDeliveryStatus = 'pending' | 'retrying' | 'succeeded' | 'dead';

export type Webhook = {
  id: string;
  name: string;
  url: string;
  /** Event types or `group.*` patterns. */
  events: string[];
  enabled: boolean;
  allowPrivateNetwork: boolean;
  maxAttempts: number;
  /** The site whose events it receives; null for a network-wide webhook (every site's events). */
  site: SiteRef | null;
  lastDelivery: { status: WebhookDeliveryStatus; at: string } | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type CreateWebhookInput = {
  name: string;
  url: string;
  events: string[];
  enabled?: boolean;
  allowPrivateNetwork?: boolean;
  maxAttempts?: number;
  /** A network-wide webhook (every site's events); otherwise it belongs to the request's site. */
  network?: boolean;
};

/** A webhook's site is fixed once created. */
export type UpdateWebhookInput = Partial<Omit<CreateWebhookInput, 'network'>> & { expectedVersion: number };

/** The JSON body every webhook delivery sends (signed; verify it with `verifyWebhookSignature`). */
export type WebhookEventBody = {
  id: string;
  type: string;
  createdAt: string;
  /** The site the event is about; null for events about no site (network-wide). */
  site: SiteRef | null;
  data: unknown;
};

/** `secret` is shown once: on creation and after rotation. */
export type WebhookWithSecret = { webhook: Webhook; secret: string };

export type WebhookAttempt = {
  attempt: number;
  at: string;
  durationMs: number;
  request: { method: string; url: string; headers: Record<string, string> };
  /** Null when no response arrived (refused, timeout, blocked by the network policy). */
  response: { status: number; headers: Record<string, string>; body: string; truncated: boolean } | null;
  error: string | null;
};

export type WebhookDelivery = {
  id: string;
  webhookId: string;
  eventId: string | null;
  eventType: string;
  isTest: boolean;
  status: WebhookDeliveryStatus;
  attempts: number;
  lastResponseStatus: number | null;
  lastError: string | null;
  payload: unknown;
  attemptLog: WebhookAttempt[];
  createdAt: string;
  updatedAt: string;
  deliveredAt: string | null;
};

// Deployments --------------------------------------------------------------------------------------

export const DEPLOYMENT_PROVIDERS = ['generic_webhook', 'cloudflare_pages', 'github'] as const;
export type DeploymentProvider = (typeof DEPLOYMENT_PROVIDERS)[number];

export const DEPLOYMENT_TRIGGERS = ['publish', 'change_set', 'schema', 'manual'] as const;
export type DeploymentTriggerPolicy = (typeof DEPLOYMENT_TRIGGERS)[number];

export const DEPLOYMENT_RUN_STATUSES = [
  'queued',
  'triggered',
  'building',
  'deployed',
  'failed',
  'unknown',
] as const;
export type DeploymentRunStatus = (typeof DEPLOYMENT_RUN_STATUSES)[number];

export type DeploymentRunTrigger = 'publish' | 'change_set' | 'schema' | 'manual' | 'retry';

/**
 * Provider settings (not secret). Generic: `{ url }`. Cloudflare Pages: `{ accountId, projectName }`.
 * GitHub: `{ owner, repo, branch, mode: 'commit' | 'pull_request', directory }`.
 */
export type DeploymentSettings = Record<string, string>;

/**
 * Secret names per provider. Generic: `signingSecret` (generated when omitted). Cloudflare Pages:
 * `deployHookUrl`, `apiToken`. GitHub: `token`. Values are write-only. A value of `${ENV:VAR_NAME}`
 * makes the server read the secret from that environment variable instead of storing it.
 */
export type DeploymentSecretsInput = Record<string, string>;

/** Which secrets are set; values never leave the server. `envVar`: read from this environment variable. */
export type DeploymentSecretState = Record<string, { set: boolean; envVar: string | null }>;

export type DeploymentTimelineEvent = {
  status: DeploymentRunStatus;
  at: string;
  source: 'shapio' | 'callback' | 'provider';
  message: string | null;
};

export type DeploymentRun = {
  id: string;
  connectionId: string;
  connectionName: string;
  provider: DeploymentProvider;
  status: DeploymentRunStatus;
  trigger: DeploymentRunTrigger;
  /** Publication sequence the run was triggered at (`?snapshot=` on delivery). */
  snapshot: number | null;
  schemaVersion: number | null;
  retryOf: string | null;
  providerRef: string | null;
  logUrl: string | null;
  siteUrl: string | null;
  error: string | null;
  /** False for providers that cannot report completion without callbacks (shown as "completion unknown"). */
  completionReported: boolean;
  timeline: DeploymentTimelineEvent[];
  triggeredAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DeploymentConnection = {
  id: string;
  name: string;
  provider: DeploymentProvider;
  settings: DeploymentSettings;
  secrets: DeploymentSecretState;
  previewUrlTemplate: string | null;
  /** Preview tokens issued for this connection show exactly what this delivery role reads. */
  deliveryRoleId: string | null;
  triggerPolicy: DeploymentTriggerPolicy[];
  debounceSeconds: number;
  allowPrivateNetwork: boolean;
  enabled: boolean;
  /** Where the site posts signed build callbacks (generic webhook connections). */
  callbackUrl: string;
  latestRun: DeploymentRun | null;
  /** The newest deployed run by snapshot: what the site is serving, as far as Shapio knows. */
  currentRun: DeploymentRun | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type CreateDeploymentConnectionInput = {
  name: string;
  provider: DeploymentProvider;
  settings: DeploymentSettings;
  secrets: DeploymentSecretsInput;
  previewUrlTemplate?: string | null;
  triggerPolicy: DeploymentTriggerPolicy[];
  debounceSeconds?: number;
  allowPrivateNetwork?: boolean;
  enabled?: boolean;
  deliveryRoleId?: string | null;
};

export type UpdateDeploymentConnectionInput = Partial<Omit<CreateDeploymentConnectionInput, 'provider'>> & {
  expectedVersion: number;
};

/** `generatedSecrets` holds secrets Shapio generated (the generic signing secret), shown once. */
export type DeploymentConnectionCreated = {
  connection: DeploymentConnection;
  generatedSecrets: Record<string, string>;
};

export type ConnectionTestResult = {
  ok: boolean;
  checks: Array<{ name: string; ok: boolean; message: string }>;
};

export type DeploymentRunQuery = { connectionId?: string; cursor?: string; limit?: number };

// Preview ------------------------------------------------------------------------------------------

export type PreviewToken = {
  id: string;
  tokenPrefix: string;
  modelId: string;
  modelKey: string | null;
  entryId: string | null;
  locale: string | null;
  connectionId: string | null;
  /** Fields follow this delivery role (within the creator's access); null = the public fields. */
  deliveryRoleId: string | null;
  createdBy: string;
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
};

export type CreatePreviewTokenInput = {
  modelKey: string;
  entryId?: string;
  locale?: string;
  /** Default 1 hour, at most 30 days. */
  ttlSeconds?: number;
  connectionId?: string;
  /** Defaults to the connection's delivery role. */
  deliveryRoleId?: string;
};

/** `token` is shown once. `url` is rendered from the connection's preview URL template (null without one). */
export type PreviewTokenCreated = { token: string; previewToken: PreviewToken; url: string | null };

export type OpenPreviewInput = {
  modelKey: string;
  entryId: string;
  locale?: string;
  /** Defaults to the first enabled connection with a preview URL template. */
  connectionId?: string;
};

/** What the entry form's Preview button opens. `apiUrl` is the preview read endpoint for this entry. */
export type OpenPreviewResult = {
  url: string | null;
  apiUrl: string;
  token: string;
  expiresAt: string;
  connectionId: string | null;
};
