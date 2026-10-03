import { trustedOutboundPolicy } from '../publishing/outbound/ssrf.js';
import { outboundPolicy, type PublishingRuntime } from '../publishing/runtime.js';
import { envRefsOf, resolveSecretValues } from '../publishing/secretRefs.js';
import type { DeploymentConnectionRow } from '../repositories/deploymentConnections.js';
import type { ProviderContext, ResolvedConnection } from './types.js';

export const settingsOf = (row: DeploymentConnectionRow): Record<string, string> =>
  Object.fromEntries(
    Object.entries((row.settings ?? {}) as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );

/** The connection with every secret resolved; throws when a referenced environment variable is unset. */
export const resolveConnection = (
  runtime: PublishingRuntime,
  row: DeploymentConnectionRow,
): ResolvedConnection => ({
  row,
  settings: settingsOf(row),
  secrets: resolveSecretValues(
    runtime.secrets.decryptJson(row.secrets_encrypted),
    envRefsOf(row.secret_env_refs),
    runtime.env,
    { strict: true, allowlist: runtime.config.secretEnvAllowlist },
  ),
});

export const providerContextFor = (
  runtime: PublishingRuntime,
  connection: ResolvedConnection,
  signal?: AbortSignal,
): ProviderContext => ({
  runtime,
  connection,
  policy: outboundPolicy(runtime, connection.row.allow_private_network),
  // Operator-configured provider APIs (CLOUDFLARE_API_URL, VERCEL_API_URL, NETLIFY_API_URL, GITHUB_API_URL).
  trustedPolicy: trustedOutboundPolicy(runtime.resolve),
  signal,
});
