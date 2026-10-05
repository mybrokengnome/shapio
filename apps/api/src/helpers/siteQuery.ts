import { SITE_QUERY_PARAMETER } from '../constants/sites.js';

const isSiteSegment = (segment: string): boolean => {
  const key = segment.split('=', 1)[0] ?? '';
  try {
    return decodeURIComponent(key.replace(/\+/g, ' ')) === SITE_QUERY_PARAMETER;
  } catch {
    return false;
  }
};

/**
 * A raw querystring (without `?`) without its `site` parameter: site resolution consumes it, and the content
 * compiler refuses unknown keys. The rest is left exactly as sent (bracket syntax is the compiler's to parse).
 */
export const withoutSiteParameter = (rawQuery: string): string =>
  rawQuery
    .split('&')
    .filter((segment) => !isSiteSegment(segment))
    .join('&');
