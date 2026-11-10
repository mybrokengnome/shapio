import type { Principal } from '../../permissions/types.js';
import { createLru } from './lru.js';

/**
 * How many lens builds a caller may cause (plan schema-lenses, review hardening). Building a lens view on a
 * cache miss reads a workspace's definitions at a version and builds its schema view; a client cycling
 * through versions could make every request do that. A caller draws cache-miss builds (hits are free) from
 * small token buckets: its own, and for app users also one all app users of a workspace share, because open
 * sign-up must not mint unlimited budget. Anonymous callers are told apart by client address, so one cannot
 * spend another's budget. In memory per process: the cost it bounds is this process's. Callers charge only
 * after the request is authorized (a rejected request never builds anything).
 */
export const LENS_BUILDS_PER_MINUTE = 30;
/** All app users of one workspace together. */
export const LENS_APP_USER_BUILDS_PER_MINUTE = 120;
/** Buckets tracked at once; past it the least recently used is forgotten (and starts full again). */
export const LENS_BUDGET_TRACKED_CALLERS = 10_000;

/**
 * The buckets one request draws from, joined by `|` (every one must have a build left): `token:<id>`,
 * `admin:<id>`, `app_user:<id>|app_users:<workspace>`, `anonymous:<workspace>:<address>`, `preview:<id>`.
 */
export type LensBudgetKey = string;

const BUCKET_SEPARATOR = '|';
const APP_USERS_PREFIX = 'app_users:';

type Bucket = { tokens: number; at: number };

const buckets = createLru<string, Bucket>(LENS_BUDGET_TRACKED_CALLERS);

const capacityOf = (bucket: string) =>
  bucket.startsWith(APP_USERS_PREFIX) ? LENS_APP_USER_BUILDS_PER_MINUTE : LENS_BUILDS_PER_MINUTE;

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
 * The budget a caller draws from on a workspace: per token, per admin, per app user (plus the ceiling all
 * app users of the workspace share), and per workspace and client address for anonymous callers. null for
 * system work, which is never limited.
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
      return [`app_user:${principal.appUserId}`, `${APP_USERS_PREFIX}${workspace}`].join(BUCKET_SEPARATOR);
    case 'anonymous':
      return `anonymous:${workspace}:${clientAddress ?? 'unknown'}`;
    default:
      return null;
  }
};

/** A preview token's own budget (preview requests carry no principal; the token is the caller). */
export const previewLensBudgetKey = (previewTokenId: string): LensBudgetKey => `preview:${previewTokenId}`;

/** Forgets every bucket (tests). */
export const resetLensBuildBudgets = (): void => buckets.clear();
