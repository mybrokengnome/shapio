import type { AdminUserApiToken } from '@shapio/client';

/** The tokens' names as one quoted list in the UI language ("“Build” and “Preview”"). */
export const formatTokenNames = (tokens: readonly AdminUserApiToken[], language: string): string =>
  new Intl.ListFormat(language, { type: 'conjunction' }).format(tokens.map((token) => `“${token.name}”`));
