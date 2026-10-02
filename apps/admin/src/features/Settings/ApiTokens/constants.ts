/** Expiry choices in days; `never` keeps the token until it's revoked. */
export const TOKEN_EXPIRY_OPTIONS = ['never', '30', '90', '365'] as const;

export type TokenExpiryOption = (typeof TOKEN_EXPIRY_OPTIONS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

export const expiryToDate = (option: TokenExpiryOption, now: Date = new Date()): string | null =>
  option === 'never' ? null : new Date(now.getTime() + Number(option) * DAY_MS).toISOString();
