import { error } from '@sveltejs/kit';
import { getSiteSettings } from '#lib/server/shapio.ts';
import { isLocale, stringsFor } from '#lib/site.ts';
import type { LayoutServerLoad } from './$types';

/** The locale's site settings (the siteSettings singleton) and UI strings, for the header and footer. */
export const load: LayoutServerLoad = async ({ params }) => {
  if (!isLocale(params.locale)) {
    error(404, 'Not found');
  }
  return {
    locale: params.locale,
    strings: stringsFor(params.locale),
    settings: await getSiteSettings(params.locale),
  };
};
