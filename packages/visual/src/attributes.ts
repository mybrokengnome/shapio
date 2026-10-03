/**
 * The attributes a site puts on an element that shows a field, so Shapio's preview can take a click on it back
 * to that field: `<h1 {...shapioAttr(article, 'title')}>`. Paths are API IDs, with list positions and nested
 * fields after slashes (`sections/2/heading`), the same paths the admin uses.
 */
export const ENTRY_ATTRIBUTE = 'data-shapio-entry';
export const PATH_ATTRIBUTE = 'data-shapio-path';
export const LOCALE_ATTRIBUTE = 'data-shapio-locale';

export type ShapioAttributes = {
  'data-shapio-entry': string;
  'data-shapio-path': string;
  'data-shapio-locale'?: string;
};

/** An entry as delivery returns it (`{ id, locale }`), or its ID. */
export type EntryRef = string | { id: string; locale?: string | null | undefined };

/**
 * A spreadable attribute object for the element that renders `path` of `entry`. The locale is the one given,
 * else the entry's own (delivery items carry the locale that served them); it is left out when unknown.
 */
export const shapioAttr = (entry: EntryRef, path: string, locale?: string): ShapioAttributes => {
  const id = typeof entry === 'string' ? entry : entry.id;
  const entryLocale = locale ?? (typeof entry === 'string' ? undefined : (entry.locale ?? undefined));
  return {
    [ENTRY_ATTRIBUTE]: id,
    [PATH_ATTRIBUTE]: path.replace(/^\/+/, ''),
    ...(entryLocale ? { [LOCALE_ATTRIBUTE]: entryLocale } : {}),
  };
};
