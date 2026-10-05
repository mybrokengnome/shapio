import { error } from '@sveltejs/kit';
import { isDraftsMode, siteUrl } from '#lib/server/config.ts';
import { getSite, getSiteSettings } from '#lib/server/shapio.ts';
import { isLocale, stringsFor } from '#lib/site.ts';
import type { LayoutServerLoad } from './$types';

/**
 * The locale's site settings (the siteSettings singleton) and UI strings, for the header and footer; the site's
 * SEO defaults and public URL, for every page's <head>; whether drafts mode is on, for its badge.
 */
export const load: LayoutServerLoad = async ({ params }) => {
  if (!isLocale(params.locale)) {
    error(404, 'Not found');
  }
  return {
    locale: params.locale,
    strings: stringsFor(params.locale),
    settings: await getSiteSettings(params.locale),
    site: await getSite(),
    siteUrl: siteUrl() ?? null,
    drafts: isDraftsMode(),
  };
};
