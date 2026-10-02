import { linkOptions } from '@tanstack/react-router';

type EntryLinkOptions = {
  /** The locale to open; omitted for the default locale and entry-wide findings (`*`). */
  locale?: string;
  /** JSON pointer (API keys) of the value to fix; the document scrolls to it (`#sections/2/title`). */
  path?: string;
};

/** An entry's document: a single type opens at its place, a collection entry at its own URL. */
export const entryLink = (
  modelKey: string,
  entryId: string,
  kind: 'collection' | 'singleton' | undefined,
  { locale, path }: EntryLinkOptions = {},
) => {
  const search = locale && locale !== '*' ? { locale } : {};
  const hash = path ? path.replace(/^\//, '') : undefined;
  return kind === 'singleton'
    ? linkOptions({ to: '/content/$modelKey', params: { modelKey }, search, ...(hash ? { hash } : {}) })
    : linkOptions({
        to: '/content/$modelKey/$entryId',
        params: { modelKey, entryId },
        search,
        ...(hash ? { hash } : {}),
      });
};
