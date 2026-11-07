import type { ThemeVariant } from '@shapio/schema';

/**
 * The GraphiQL page's URL for one workspace (`?workspace=`, left out on the primary workspace), opened on a query
 * (`?query=`) in the admin's light or dark scheme (`?theme=`; GraphiQL 3's `forcedTheme`).
 */
export type PlaygroundUrlOptions = { siteKey?: string; query?: string; theme: ThemeVariant };

export const playgroundUrl = (base: string, { siteKey, query, theme }: PlaygroundUrlOptions): string => {
  const url = new URL(base);
  if (siteKey) {
    url.searchParams.set('workspace', siteKey);
  }
  if (query?.trim()) {
    url.searchParams.set('query', query);
  }
  url.searchParams.set('theme', theme);
  return url.href;
};
