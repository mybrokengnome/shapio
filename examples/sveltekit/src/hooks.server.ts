import type { Handle } from '@sveltejs/kit/hooks';
import { DEFAULT_LOCALE, isLocale } from '#lib/site.ts';

/** `<html lang>` follows the page's locale segment (`/fr/…` → `fr`). */
export const handle: Handle = ({ event, resolve }) => {
  const segment = event.params.locale ?? '';
  const lang = isLocale(segment) ? segment : DEFAULT_LOCALE;
  return resolve(event, { transformPageChunk: ({ html }) => html.replace('%lang%', lang) });
};
