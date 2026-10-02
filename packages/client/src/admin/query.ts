type QueryValue = string | number | boolean | null | undefined;

/** Serialises defined values into a `?a=1&b=2` string (empty when nothing is set). */
export const toQueryString = (query: Readonly<Record<string, QueryValue>>): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, String(value));
    }
  }
  const serialised = params.toString();
  return serialised ? `?${serialised}` : '';
};
