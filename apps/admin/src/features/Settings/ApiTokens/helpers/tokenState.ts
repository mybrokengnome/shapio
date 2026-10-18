import type { ApiToken } from '@shapio/client';

/** A token this close to its expiry shows how many days it has left, in the warning tone. */
export const EXPIRY_WARNING_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * What a token's status says. Expired comes first: it is final, while a paused token (its creator's account
 * is disabled) works again once they are enabled. `expiring` carries the days left, rounded up (never 0).
 */
export type TokenState =
  { kind: 'expired' } | { kind: 'paused' } | { kind: 'expiring'; days: number } | { kind: 'active' };

export const tokenStateOf = (
  token: Pick<ApiToken, 'expiresAt' | 'creatorDisabled'>,
  now: number,
): TokenState => {
  const left = token.expiresAt ? new Date(token.expiresAt).getTime() - now : undefined;
  if (left !== undefined && left <= 0) {
    return { kind: 'expired' };
  }
  if (token.creatorDisabled) {
    return { kind: 'paused' };
  }
  const days = left === undefined ? undefined : Math.ceil(left / DAY_MS);
  return days !== undefined && days <= EXPIRY_WARNING_DAYS ? { kind: 'expiring', days } : { kind: 'active' };
};

/** The tokens the list shows: revoked ones are gone for good, so they are left out. */
export const listedTokens = (tokens: readonly ApiToken[]): ApiToken[] =>
  tokens.filter((token) => token.revokedAt === null);
