import { error } from '@sveltejs/kit';
import { listPages } from '#lib/server/shapio.ts';
import { HOME_SLUG, isLocale, LOCALES } from '#lib/site.ts';
import type { EntryGenerator, PageServerLoad } from './$types';

/** Pages from the `page` collection; `home` is the locale's front page (`/en/`), the others `/en/<slug>/`. */
export const entries: EntryGenerator = async () => {
  const paths = [];
  for (const locale of LOCALES) {
    for (const page of await listPages(locale)) {
      paths.push({ locale, slug: page.slug === HOME_SLUG ? '' : page.slug });
    }
  }
  return paths;
};

export const load: PageServerLoad = async ({ params }) => {
  // A rest parameter keeps the trailing slash (`about/`; trailingSlash is 'always').
  const slug = params.slug.replace(/\/+$/, '');
  const wanted = slug === '' ? HOME_SLUG : slug;
  const page = isLocale(params.locale)
    ? (await listPages(params.locale)).find((candidate) => candidate.slug === wanted)
    : undefined;
  if (!page) {
    error(404, 'Not found');
  }
  return { page };
};
