import { LOCALES } from '#lib/site.ts';
import type { EntryGenerator } from './$types';

/** The siteSettings singleton is loaded by the locale layout; this page only needs its locales listed. */
export const entries: EntryGenerator = () => LOCALES.map((locale) => ({ locale }));
