import { isIP } from 'node:net';
import type { Principal } from '../../permissions/types.js';
import { createLru } from './lru.js';

/**
 * How many lens builds a caller may cause (plan schema-lenses, review hardening). Building a lens view on a
 * cache miss reads a workspace's definitions at a version and builds its schema view; a client cycling
 * through versions could make every request do that. A caller draws cache-miss builds (hits are free) from
 * its own small token bucket. App users get a smaller one (open sign-up mints app users cheaply) and also
 * draw from their client network's bucket, so many accounts signed up from one network share one ceiling
 * while accounts on other networks are unaffected; the segmented view cache keeps the versions real
 * clients read hot, so they rarely need a build at all.
 * Anonymous callers are told apart by network: an IPv4 address, or an IPv6 /64 (one subscriber's usual
 * allocation), so one cannot spend another's budget nor mint budget by rotating addresses within its
 * prefix. Behind a reverse proxy without `TRUST_PROXY`, the client address is the proxy's and every
 * anonymous caller shares one bucket: set `TRUST_PROXY` there, to the number of proxy hops (with `true`,
 * the left-most `X-Forwarded-For` entry, which the client writes, is taken as its address). A value that is
 * not an IP address counts as one shared `unknown` network, so forged strings never mint buckets. In memory per process: the cost it bounds is
 * this process's. Callers charge only after the request is authorized (a rejected request builds nothing).
 */
export const LENS_BUILDS_PER_MINUTE = 30;
/** Each app user's own budget. */
export const LENS_APP_USER_BUILDS_PER_MINUTE = 10;
/** Buckets tracked at once; past it the least recently used is forgotten (and starts full again). */
export const LENS_BUDGET_TRACKED_CALLERS = 10_000;

/**
 * The buckets one request draws from, joined by `|` (every one must have a build left): `token:<id>`,
 * `admin:<id>`, `app_user:<id>|network:<workspace>:<network>`, `anonymous:<workspace>:<network>`,
 * `preview:<id>`.
 */
export type LensBudgetKey = string;

const BUCKET_SEPARATOR = '|';
const APP_USER_PREFIX = 'app_user:';
/** What a value that is not an IP address counts as. */
const UNKNOWN_NETWORK = 'unknown';
/** Longer than any IP address with a zone: not one. */
const MAX_ADDRESS_LENGTH = 64;

type Bucket = { tokens: number; at: number };

const buckets = createLru<string, Bucket>(LENS_BUDGET_TRACKED_CALLERS);

const capacityOf = (bucket: string) =>
  bucket.startsWith(APP_USER_PREFIX) ? LENS_APP_USER_BUILDS_PER_MINUTE : LENS_BUILDS_PER_MINUTE;

/** The eight hextets of an IPv6 address (`::` expanded, an embedded IPv4 tail as two hextets). */
const hextetsOf = (address: string): string[] => {
  let text = address;
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(text)?.[1];
  if (tail) {
    const [a, b, c, d] = tail.split('.').map(Number) as [number, number, number, number];
    text = `${text.slice(0, -tail.length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = '', rest] = text.split('::');
  const left = head ? head.split(':') : [];
  const right = rest ? rest.split(':') : [];
  const zeros = rest === undefined ? [] : Array.from({ length: 8 - left.length - right.length }, () => '0');
  return [...left, ...zeros, ...right].map((hextet) => (parseInt(hextet, 16) || 0).toString(16));
};

/**
 * The network a caller is budgeted as: an IPv4 address (an IPv4-mapped IPv6 one included) or an IPv6 /64.
 * Anything that is not a syntactically valid IP address (a forged `X-Forwarded-For` value) is `unknown`, one
 * shared network, so arbitrary strings never become bucket keys.
 */
export const clientNetworkOf = (address: string): string => {
  if (address.length > MAX_ADDRESS_LENGTH) {
    return UNKNOWN_NETWORK;
  }
  const bare = address.split('%')[0] ?? '';
  const family = isIP(bare);
  if (family === 4) {
    return bare;
  }
  if (family !== 6) {
    return UNKNOWN_NETWORK;
  }
  const hextets = hextetsOf(bare.toLowerCase());
  const mapped = hextets.slice(0, 5).every((hextet) => hextet === '0') && hextets[5] === 'ffff';
  if (mapped) {
    const [high, low] = [parseInt(hextets[6] ?? '0', 16), parseInt(hextets[7] ?? '0', 16)];
    return [high >> 8, high & 255, low >> 8, low & 255].join('.');
  }
  return `${hextets.slice(0, 4).join(':')}::/64`;
};

const networkOf = (clientAddress: string | undefined) =>
  clientAddress === undefined ? UNKNOWN_NETWORK : clientNetworkOf(clientAddress);

/** The builds a bucket holds at `now`; a clock that went backwards refills nothing. */
const tokensAt = (bucket: string, now: number): number => {
  const capacity = capacityOf(bucket);
  const previous = buckets.get(bucket);
  if (!previous) {
    return capacity;
  }
  const elapsed = Math.max(0, now - previous.at);
  return Math.min(capacity, previous.tokens + (elapsed * capacity) / 60_000);
};

/** Takes one cache-miss build from every bucket of `budget`; false, taking nothing, when any is empty. */
export const takeLensBuildBudget = (budget: LensBudgetKey, now: number = Date.now()): boolean => {
  const keys = budget.split(BUCKET_SEPARATOR);
  const levels = keys.map((key) => tokensAt(key, now));
  const allowed = levels.every((tokens) => tokens >= 1);
  keys.forEach((key, index) => {
    const tokens = levels[index] as number;
    buckets.set(key, { tokens: allowed ? tokens - 1 : tokens, at: now });
  });
  return allowed;
};

/**
 * The budget a caller draws from on a workspace: per token, per admin, per app user together with its client
 * network's ceiling, and per workspace and client network (`clientNetworkOf`) for anonymous callers. null for system work, which is never limited.
 */
export const lensBudgetKeyOf = (
  principal: Principal,
  siteId: string | null,
  clientAddress?: string,
): LensBudgetKey | null => {
  const workspace = siteId ?? 'shared';
  switch (principal.kind) {
    case 'token':
      return `token:${principal.tokenId}`;
    case 'admin':
      return `admin:${principal.adminUserId}`;
    case 'appUser':
      return [
        `${APP_USER_PREFIX}${principal.appUserId}`,
        `network:${workspace}:${networkOf(clientAddress)}`,
      ].join(BUCKET_SEPARATOR);
    case 'anonymous':
      return `anonymous:${workspace}:${networkOf(clientAddress)}`;
    default:
      return null;
  }
};

/** A preview token's own budget (preview requests carry no principal; the token is the caller). */
export const previewLensBudgetKey = (previewTokenId: string): LensBudgetKey => `preview:${previewTokenId}`;

/** Forgets every bucket (tests). */
export const resetLensBuildBudgets = (): void => buckets.clear();
