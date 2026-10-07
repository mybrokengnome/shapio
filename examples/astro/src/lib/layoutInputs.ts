import { buildEnvKey } from './cacheKey.js';
import { getSite, getSiteSettings } from './shapio.js';
import type { Locale } from './site.js';

/**
 * Everything layouts/Base.astro reads when it renders, besides its props: the site settings and the site's SEO
 * defaults (both read once per build) and the build environment. The layout reads through this function and
 * every keyed page folds it into its `cacheKey`, so a read added to the layout is in the key too.
 */
export const layoutInputs = async (locale: Locale) => {
  const [settings, site] = await Promise.all([getSiteSettings(locale), getSite()]);
  return { settings, site, env: buildEnvKey() };
};
