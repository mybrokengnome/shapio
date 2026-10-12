/** A list row's draft as the list read it. */
export type VersionedRow = { id: string; locale: string; version: number };

/**
 * The draft version a list row shows for the locale being published (null: a model that isn't localized),
 * sent with the publish so a draft saved since the list loaded is refused. Undefined when the row was read
 * from another locale (a fallback): the list never showed that draft's version, so nothing guards it.
 */
export const expectedVersionOf = (row: VersionedRow, locale: string | null): number | undefined =>
  locale === null || row.locale === locale ? row.version : undefined;
