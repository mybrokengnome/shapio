/**
 * The entries in a delivery response body (`data` is one entry or a list), with what an "Edit entry" link
 * needs: the ID, the locale it was served in, and a short label (a `title`-like field when present).
 */
export type ResponseEntry = { id: string; locale: string | undefined; label: string | undefined };

const LABEL_KEYS = ['title', 'name', 'label', 'heading', 'slug'] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const toEntry = (value: unknown): ResponseEntry[] => {
  if (!isRecord(value) || typeof value.id !== 'string') {
    return [];
  }
  const labelKey = LABEL_KEYS.find((key) => typeof value[key] === 'string' && value[key] !== '');
  return [
    {
      id: value.id,
      locale: typeof value.locale === 'string' ? value.locale : undefined,
      label: labelKey ? String(value[labelKey]) : undefined,
    },
  ];
};

export const responseEntries = (body: unknown): ResponseEntry[] => {
  if (!isRecord(body)) {
    return [];
  }
  return Array.isArray(body.data) ? body.data.flatMap(toEntry) : toEntry(body.data);
};
