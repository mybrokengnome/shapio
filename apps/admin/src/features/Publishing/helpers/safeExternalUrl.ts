/**
 * Only http(s) links are rendered. Log and site URLs come from build callbacks and providers, so a
 * `javascript:` or `data:` URL must never become a clickable link in the admin.
 */
export const safeExternalUrl = (value: string | null | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
  } catch {
    return undefined;
  }
};
