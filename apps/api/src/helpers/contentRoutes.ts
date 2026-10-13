import { MAX_INHERITANCE_DEPTH, MAX_ROUTE_KEY_LENGTH, splitRoutePath } from '@shapio/schema';

/**
 * Nested content routes (plan polymorphic-types, D4). A model that extends another is served under its
 * ancestors' route keys: `/api/content/products/digital/<id>`. Fastify's `/:modelKey/:id` would take
 * `digital` for the ID, so the server rewrites the URL first: the leading path segments that are API IDs
 * (an entry ID is a UUID, which always has a hyphen; an API ID never does) are joined with `/` and
 * percent-encoded into one segment, `/api/content/products%2Fdigital/<id>`, which the existing routes and
 * params schemas take as they are (Fastify decodes params). Purely syntactic: no registry access, and only
 * the delivery and preview content prefixes are touched (admin content routes take API IDs).
 */

/** App-relative prefixes whose following segments start with a route key. */
export const CONTENT_ROUTE_PREFIXES = ['/api/content/', '/api/preview/content/'] as const;

/**
 * The longest `:modelKey` param once rewritten: the longest route key with every separator encoded (`/` is
 * `%2F`, two characters more). Never below Fastify's default of 100.
 */
export const MAX_ROUTE_PARAM_LENGTH = Math.max(100, MAX_ROUTE_KEY_LENGTH + 2 * (MAX_INHERITANCE_DEPTH - 1));

const decodeSegment = (segment: string): string | undefined => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
};

/**
 * Splits the decoded segments after a content prefix into the route key and the rest (`splitRoutePath`),
 * with how many segments the key took. Undefined when a segment does not decode or none is a key.
 */
export const splitContentPath = (
  rawSegments: readonly string[],
): { routeKey: string; consumed: number; rest: string[] } | undefined => {
  const decoded = rawSegments.map(decodeSegment);
  if (decoded.some((segment) => segment === undefined)) {
    return undefined;
  }
  const split = splitRoutePath(decoded as string[]);
  return split ? { ...split, consumed: decoded.length - split.rest.length } : undefined;
};

/**
 * A request URL (path and query, BASE_PATH included) with a nested route key folded into one segment; any
 * other URL unchanged.
 */
export const rewriteContentUrl = (url: string, basePath: string): string => {
  const queryAt = url.indexOf('?');
  const path = queryAt === -1 ? url : url.slice(0, queryAt);
  const prefix = CONTENT_ROUTE_PREFIXES.map((candidate) => `${basePath}${candidate}`).find((candidate) =>
    path.startsWith(candidate),
  );
  if (prefix === undefined) {
    return url;
  }
  const segments = path.slice(prefix.length).split('/');
  const split = splitContentPath(segments);
  // One segment needs nothing joined (a root's key, or a key already sent as `products%2Fdigital`).
  if (!split || split.consumed <= 1) {
    return url;
  }
  const rest = segments.slice(split.consumed);
  return [
    prefix,
    encodeURIComponent(split.routeKey),
    rest.length > 0 ? `/${rest.join('/')}` : '',
    queryAt === -1 ? '' : url.slice(queryAt),
  ].join('');
};
