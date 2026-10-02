import { BlockList, isIP } from 'node:net';
import type { RawConfig } from './schema.js';

/** Outbound requests (webhooks, deploy hooks, provider APIs) and provider endpoints (package H). */
export type PublishingConfig = {
  /**
   * CIDRs (or single IPs) that webhooks and deployment connections may reach although they are private,
   * loopback or link-local. Each webhook or connection must also opt in (`allowPrivateNetwork`).
   */
  privateNetworkAllowlist: string[];
  /** SECRET_ENV_ALLOWLIST: extra variable names or `PREFIX*` patterns `${ENV:NAME}` may name (SHAPIO_SECRET_* always). */
  secretEnvAllowlist: string[];
  /** Timeout for one outbound request, connect to last byte. */
  outboundTimeoutMs: number;
  /** Cloudflare API base (no trailing slash); the token is only ever sent here. */
  cloudflareApiUrl: string;
  /** Cloudflare dashboard base, for links to a deployment's build log. */
  cloudflareDashboardUrl: string;
  /** GitHub REST API base (no trailing slash); set it for GitHub Enterprise Server. */
  githubApiUrl: string;
};

const parseList = (value: string): string[] =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

/** `10.0.0.0/8`, `fd00::/8` or a single address. Returns the parts, or undefined when malformed. */
export const parseCidr = (
  value: string,
): { address: string; prefix: number; type: 'ipv4' | 'ipv6' } | undefined => {
  const [address = '', prefixText, extra] = value.split('/');
  const version = isIP(address);
  if (version === 0 || extra !== undefined) {
    return undefined;
  }
  const max = version === 4 ? 32 : 128;
  const prefix = prefixText === undefined ? max : Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > max) {
    return undefined;
  }
  return { address, prefix, type: version === 4 ? 'ipv4' : 'ipv6' };
};

/** A BlockList of the allowlisted ranges (BlockList.check answers "is this address listed"). */
export const toAllowlist = (cidrs: readonly string[]): BlockList => {
  const list = new BlockList();
  for (const cidr of cidrs) {
    const parsed = parseCidr(cidr);
    if (parsed) {
      list.addSubnet(parsed.address, parsed.prefix, parsed.type);
    }
  }
  return list;
};

const trimSlash = (value: string) => value.replace(/\/+$/, '');

export const toPublishingConfig = (raw: RawConfig): PublishingConfig => ({
  privateNetworkAllowlist: parseList(raw.OUTBOUND_PRIVATE_NETWORK_ALLOWLIST),
  secretEnvAllowlist: parseList(raw.SECRET_ENV_ALLOWLIST),
  outboundTimeoutMs: raw.OUTBOUND_TIMEOUT_MS,
  cloudflareApiUrl: trimSlash(raw.CLOUDFLARE_API_URL),
  cloudflareDashboardUrl: trimSlash(raw.CLOUDFLARE_DASHBOARD_URL),
  githubApiUrl: trimSlash(raw.GITHUB_API_URL),
});

const SECRET_ENV_ENTRY = /^[A-Za-z_][A-Za-z0-9_]*\*?$/;

export const publishingProblems = (raw: RawConfig): string[] => {
  const invalid = parseList(raw.OUTBOUND_PRIVATE_NETWORK_ALLOWLIST).filter((cidr) => !parseCidr(cidr));
  const invalidSecretEnv = parseList(raw.SECRET_ENV_ALLOWLIST).filter(
    (entry) => !SECRET_ENV_ENTRY.test(entry),
  );
  return [
    ...(invalid.length > 0
      ? [
          `OUTBOUND_PRIVATE_NETWORK_ALLOWLIST has invalid entries: ${invalid.join(', ')} (use CIDRs such as 10.0.0.0/8 or single IPs)`,
        ]
      : []),
    ...(invalidSecretEnv.length > 0
      ? [
          `SECRET_ENV_ALLOWLIST has invalid entries: ${invalidSecretEnv.join(', ')} (use variable names or prefixes such as CF_PAGES_*)`,
        ]
      : []),
  ];
};
