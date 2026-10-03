import { redirect } from '@sveltejs/kit';
import { DEFAULT_LOCALE } from '#lib/site.ts';

/** The front page lives under its locale (`/en/`); prerendered as a redirect page. */
export const load = () => {
  redirect(307, `/${DEFAULT_LOCALE}/`);
};
