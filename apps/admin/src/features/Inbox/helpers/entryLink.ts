import { linkOptions } from '@tanstack/react-router';

type EntryLinkOptions = {
  /** The locale to open; omitted for the default locale and entry-wide findings (`*`). */
  locale?: string;
  /** JSON pointer (API keys) of the value to fix; the document scrolls to it (`#sections/2/title`). */
  path?: string;
  /** With `path`, a relation's linked entry to point out there (`?target=`). */
  target?: string;
};

/** An entry's document: a single type opens at its place, a collection entry at its own URL. */
export const entryLink = (
  modelKey: string,
  entryId: string,
  kind: 'collection' | 'singleton' | undefined,
  { locale, path, target }: EntryLinkOptions = {},
) => {
  const search = {
    ...(locale && locale !== '*' ? { locale } : {}),
    ...(path && target ? { target } : {}),
  };
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
