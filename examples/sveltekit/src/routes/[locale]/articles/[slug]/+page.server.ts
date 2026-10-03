import { error } from '@sveltejs/kit';
import { listArticles } from '#lib/server/shapio.ts';
import { isLocale, LOCALES } from '#lib/site.ts';
import type { EntryGenerator, PageServerLoad } from './$types';

/** Published articles only: a draft has no page, so its URL is a 404. */
export const entries: EntryGenerator = async () => {
  const paths = [];
  for (const locale of LOCALES) {
    for (const article of await listArticles(locale)) {
      paths.push({ locale, slug: article.slug });
    }
  }
  return paths;
};

export const load: PageServerLoad = async ({ params }) => {
  const article = isLocale(params.locale)
    ? (await listArticles(params.locale)).find((candidate) => candidate.slug === params.slug)
    : undefined;
  if (!article) {
    error(404, 'Not found');
  }
  return { article };
};
