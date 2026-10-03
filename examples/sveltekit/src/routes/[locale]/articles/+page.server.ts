import { listArticles } from '#lib/server/shapio.ts';
import { DEFAULT_LOCALE, isLocale, LOCALES } from '#lib/site.ts';
import type { EntryGenerator, PageServerLoad } from './$types';

export const entries: EntryGenerator = () => LOCALES.map((locale) => ({ locale }));

export const load: PageServerLoad = async ({ params }) => ({
  articles: await listArticles(isLocale(params.locale) ? params.locale : DEFAULT_LOCALE),
});
