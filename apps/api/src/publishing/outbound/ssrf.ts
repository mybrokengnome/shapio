import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

/**
 * SSRF protection for every request Shapio sends to an address an admin typed in (webhooks, deploy hooks,
 * provider APIs). The host is resolved once, every resolved address is checked, and the connection is then
 * pinned to the checked address (outbound/request.ts), so a DNS answer that changes between the check and
 * the connect (DNS rebinding) cannot redirect the request. Redirects are never followed.
 *
 * Private, loopback, link-local, carrier-grade NAT, multicast and reserved ranges are refused unless the
 * target opted in (`allowPrivateNetwork`) AND the address is in the operator's allowlist
 * (OUTBOUND_PRIVATE_NETWORK_ALLOWLIST). Both are needed: an admin account alone cannot reach the internal
 * network, and the operator's list alone does not open every webhook to it.
 */

export type ResolvedAddress = { address: string; family: 4 | 6 };

/** DNS resolution, injectable so tests can make a public-looking name resolve to a private address. */
export type HostResolver = (hostname: string) => Promise<ResolvedAddress[]>;

export const systemResolver: HostResolver = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map((entry) => ({
    address: entry.address,
    family: entry.family === 6 ? 6 : 4,
  }));

export type OutboundPolicy = {
  /** The webhook or connection opted in to private destinations. */
  allowPrivateNetwork: boolean;
  /** Operator-controlled ranges private destinations must also be in. */
  allowlist: BlockList;
  resolve: HostResolver;
};

export class OutboundBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutboundBlockedError';
  }
}

const RESTRICTED_V4: ReadonlyArray<[string, number]> = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local (cloud metadata endpoints live here)
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.88.99.0', 24], // 6to4 relay anycast
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, including broadcast
];

const RESTRICTED_V6: ReadonlyArray<[string, number]> = [
  ['::', 96], // unspecified, loopback and the deprecated IPv4-compatible form (::a.b.c.d)
  ['100::', 64], // discard
  // Transition forms that can tunnel to any IPv4 address, private ones included. Refused outright: a real
  // webhook or deploy endpoint does not live there, and decoding each form is error-prone.
  ['2002::', 16], // 6to4
  ['2001::', 32], // Teredo
  ['64:ff9b:1::', 48], // NAT64 local-use
  ['2001:db8::', 32], // documentation
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['fec0::', 10], // site-local (deprecated)
  ['ff00::', 8], // multicast
];

const RESTRICTED = (() => {
  const list = new BlockList();
  RESTRICTED_V4.forEach(([address, prefix]) => list.addSubnet(address, prefix, 'ipv4'));
  RESTRICTED_V6.forEach(([address, prefix]) => list.addSubnet(address, prefix, 'ipv6'));
  return list;
})();

/** The IPv4 address embedded in IPv4-mapped (::ffff:a.b.c.d) or well-known NAT64 (64:ff9b::/96) forms. */
const embeddedIpv4 = (address: string): string | undefined => {
  const lower = address.toLowerCase();
  const dotted = /^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (dotted?.[1]) {
    return dotted[1];
  }
  const hex = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (hex?.[1] && hex[2]) {
    const high = parseInt(hex[1], 16);
    const low = parseInt(hex[2], 16);
    return [high >> 8, high & 255, low >> 8, low & 255].join('.');
  }
  return undefined;
};

const typeOf = (address: string) => (isIP(address) === 6 ? 'ipv6' : 'ipv4');

/** Whether an address is private, loopback, link-local or otherwise not a public internet address. */
export const isRestrictedAddress = (address: string): boolean => {
  const mapped = embeddedIpv4(address);
  if (mapped) {
    return RESTRICTED.check(mapped, 'ipv4');
  }
  return RESTRICTED.check(address, typeOf(address));
};

const isAllowedPrivate = (address: string, policy: OutboundPolicy) => {
  if (!policy.allowPrivateNetwork) {
    return false;
  }
  const mapped = embeddedIpv4(address);
  return mapped ? policy.allowlist.check(mapped, 'ipv4') : policy.allowlist.check(address, typeOf(address));
};

/** Parses a destination URL: http(s) only, no credentials in the URL. */
export const parseDestination = (value: string): URL => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OutboundBlockedError('The URL is not valid');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new OutboundBlockedError('Only http and https URLs are allowed');
  }
  if (url.username !== '' || url.password !== '') {
    throw new OutboundBlockedError('URLs must not contain credentials; use the secret fields instead');
  }
  return url;
};

const bareHost = (url: URL) => url.hostname.replace(/^\[|\]$/g, '');

/**
 * Resolves a destination and returns the one address to connect to. Every resolved address must pass:
 * a name that resolves to a mix of public and private addresses is refused outright.
 */
export const resolveDestination = async (url: URL, policy: OutboundPolicy): Promise<ResolvedAddress> => {
  const host = bareHost(url);
  const literal = isIP(host);
  let addresses: ResolvedAddress[];
  if (literal !== 0) {
    addresses = [{ address: host, family: literal === 6 ? 6 : 4 }];
  } else {
    try {
      addresses = await policy.resolve(host);
    } catch (error) {
      throw new OutboundBlockedError(
        `Could not resolve ${host}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (addresses.length === 0) {
    throw new OutboundBlockedError(`${host} did not resolve to any address`);
  }
  const blocked = addresses.find(
    (candidate) => isRestrictedAddress(candidate.address) && !isAllowedPrivate(candidate.address, policy),
  );
  if (blocked) {
    throw new OutboundBlockedError(
      `${host} resolves to ${blocked.address}, a private or reserved address. Private destinations need ` +
        'the server allowlist (OUTBOUND_PRIVATE_NETWORK_ALLOWLIST) and "allow private network" on this target.',
    );
  }
  return addresses[0] as ResolvedAddress;
};
