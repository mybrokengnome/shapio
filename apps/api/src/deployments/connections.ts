import { BlockList } from 'node:net';
import { outboundPolicy, type PublishingRuntime } from '../publishing/runtime.js';
import { envRefsOf, resolveSecretValues } from '../publishing/secretRefs.js';
import type { DeploymentConnectionRow } from '../repositories/deploymentConnections.js';
import type { ProviderContext, ResolvedConnection } from './types.js';

/** Everything is allowed for operator-configured provider APIs (CLOUDFLARE_API_URL, GITHUB_API_URL). */
const EVERYWHERE = (() => {
  const list = new BlockList();
  list.addSubnet('0.0.0.0', 0, 'ipv4');
  list.addSubnet('::', 0, 'ipv6');
  return list;
})();

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
  trustedPolicy: { allowPrivateNetwork: true, allowlist: EVERYWHERE, resolve: runtime.resolve },
  signal,
});
