import type { LocationRewrite } from '@tanstack/react-router';
import { splitSitePath, withSitePrefix } from './sitePaths';

/**
 * The router works on site-free paths (`/content/posts`); the address bar carries the site
 * (`/admin/s/blog/content/posts`). Runs inside the basepath rewrite: `url.pathname` here is already relative
 * to `{BASE_PATH}/admin`. Input drops the site prefix; output adds the current site's prefix to every site
 * page (network pages and signed-out screens keep their plain URLs).
 */
export const createSiteRewrite = (siteKey: () => string | undefined): LocationRewrite => ({
  input: ({ url }) => {
    url.pathname = splitSitePath(url.pathname).rest;
    return url;
  },
  output: ({ url }) => {
    url.pathname = withSitePrefix(url.pathname, siteKey());
    return url;
  },
});
