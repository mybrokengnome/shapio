import { VISUAL_QUERY_PARAM } from '@shapio/visual';

/** The preview URL the pane frames: the site's URL with `?shapio-visual=1` (a `#token=` fragment survives). */
export const framedPreviewUrl = (url: string): string => {
  const framed = new URL(url);
  framed.searchParams.set(VISUAL_QUERY_PARAM, '1');
  return framed.href;
};

/** The origin of an http(s) URL, or undefined. */
export const httpOriginOf = (url: string): string | undefined => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Whether the admin may frame a preview URL: http(s), and never on the admin's own origin (a framed page on it
 * could script the admin; the API refuses such templates and the CSP never lists the origin).
 */
export const canFramePreview = (url: string, adminOrigin: string): boolean => {
  const origin = httpOriginOf(url);
  return origin !== undefined && origin !== adminOrigin;
};
