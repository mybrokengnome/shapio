import type { Principal } from '../../permissions/types.js';
import { createLru } from './lru.js';

/**
 * How many lens builds a caller may cause (plan schema-lenses, review hardening). Building a lens view on a
 * cache miss reads a workspace's definitions at a version and builds its schema view; a client cycling
 * through versions could make every request do that. Each caller gets a small token bucket for cache-miss
 * builds only (hits are free); anonymous callers share one bucket per workspace. In memory per process: the
 * cost it bounds is this process's.
 */
export const LENS_BUILDS_PER_MINUTE = 30;
/** Callers tracked at once; past it the least recently seen is forgotten (and starts with a full bucket). */
export const LENS_BUDGET_TRACKED_CALLERS = 10_000;

const REFILL_PER_MS = LENS_BUILDS_PER_MINUTE / 60_000;

type Bucket = { tokens: number; at: number };

const buckets = createLru<string, Bucket>(LENS_BUDGET_TRACKED_CALLERS);

/** Takes one cache-miss build from the caller's bucket; false when it is empty. */
export const takeLensBuildBudget = (principalKey: string, now: number = Date.now()): boolean => {
  const previous = buckets.get(principalKey);
  const tokens = previous
    ? Math.min(LENS_BUILDS_PER_MINUTE, previous.tokens + (now - previous.at) * REFILL_PER_MS)
    : LENS_BUILDS_PER_MINUTE;
  if (tokens < 1) {
    buckets.set(principalKey, { tokens, at: now });
    return false;
  }
  buckets.set(principalKey, { tokens: tokens - 1, at: now });
  return true;
};

/**
 * The bucket a caller draws from on a workspace: one per token, admin, or app user; one shared by every
 * anonymous caller of the workspace. null for system work, which is never limited.
 */
export const lensBudgetKeyOf = (principal: Principal, siteId: string | null): string | null => {
  switch (principal.kind) {
    case 'token':
      return `token:${principal.tokenId}`;
    case 'admin':
      return `admin:${principal.adminUserId}`;
    case 'appUser':
      return `app_user:${principal.appUserId}`;
    case 'anonymous':
      return `anonymous:${siteId ?? 'shared'}`;
    default:
      return null;
  }
};

/** Forgets every bucket (tests). */
export const resetLensBuildBudgets = (): void => buckets.clear();
