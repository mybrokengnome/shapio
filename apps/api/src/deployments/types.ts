import type { PublishingJobEnvironment } from '../publishing/jobEnvironment.js';
import type { OutboundPolicy } from '../publishing/outbound/ssrf.js';
import type { PublishingRuntime } from '../publishing/runtime.js';
import type { DeploymentConnectionRow } from '../repositories/deploymentConnections.js';
import type { DeploymentRunRow } from '../repositories/deploymentRuns.js';
import type { RunReport } from './status.js';
import type { ConnectionTestResult } from './testResult.js';

export const DEPLOYMENT_PROVIDER_IDS = ['generic_webhook', 'cloudflare_pages', 'github'] as const;
export type DeploymentProviderId = (typeof DEPLOYMENT_PROVIDER_IDS)[number];

export const TRIGGER_POLICIES = ['publish', 'change_set', 'schema', 'manual'] as const;
export type TriggerPolicy = (typeof TRIGGER_POLICIES)[number];

/** A connection as providers see it: settings plus decrypted secrets. Never logged. */
export type ResolvedConnection = {
  row: DeploymentConnectionRow;
  settings: Record<string, string>;
  secrets: Record<string, string>;
};

export type ProviderContext = {
  runtime: PublishingRuntime;
  connection: ResolvedConnection;
  /** Outbound policy for admin-entered destinations (deploy hook, generic URL). */
  policy: OutboundPolicy;
  /** Policy for operator-configured provider APIs (CLOUDFLARE_API_URL, GITHUB_API_URL). */
  trustedPolicy: OutboundPolicy;
  signal?: AbortSignal | undefined;
};

export type RunContext = ProviderContext & {
  run: DeploymentRunRow;
  /** Schema registry and friends, for providers that export the schema (GitHub write-back). */
  environment: PublishingJobEnvironment;
  /** When this run's trigger was first attempted (a retry after a crash may adopt that deployment). */
  previousAttemptAt: Date | undefined;
};

export type SettingSpec = { name: string; required: boolean; pattern?: RegExp; defaultValue?: string };

export type DeploymentProviderAdapter = {
  id: DeploymentProviderId;
  settings: readonly SettingSpec[];
  /** Secret names; `generated` ones are created by Shapio when omitted (shown once). */
  secrets: ReadonlyArray<{ name: string; required: boolean; generated?: boolean }>;
  /** Whether runs get a final state without the site's callbacks. */
  reportsCompletion: boolean;
  /** Admin-entered URLs (settings or secrets) to check against the network policy when saving. */
  destinations: (connection: Pick<ResolvedConnection, 'settings' | 'secrets'>) => string[];
  trigger: (context: RunContext) => Promise<RunReport>;
  /** Asks the provider for the run's state; providers without it rely on callbacks. */
  poll?: (context: RunContext) => Promise<RunReport>;
  test: (context: ProviderContext) => Promise<ConnectionTestResult>;
};
