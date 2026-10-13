import { MAX_INHERITANCE_DEPTH } from '../inheritance/resolve.js';
import type { ModelDefinition } from '../types/definitions.js';
import { API_KEY_PATTERN, MAX_API_KEY_LENGTH } from '../validators/apiKey.js';
import { routeKeyOf } from '../validators/naming.js';

/**
 * Nested delivery paths (plan polymorphic-types). A model that extends another is addressed under its
 * ancestors: `/api/content/products/digital` is the route key `products/digital`, the ancestors' route keys
 * (`routeKeyOf`) and its own, joined by `/`. `routeKeyOf` alone stays the plural API ID that GraphQL names
 * and the API ID namespace use.
 */

const SEGMENT = API_KEY_PATTERN.source.slice(1, -1);

/** A route key: one to MAX_INHERITANCE_DEPTH API IDs joined by `/` (`products/digital`). */
export const ROUTE_KEY_PATTERN = new RegExp(`^${SEGMENT}(?:/${SEGMENT}){0,${MAX_INHERITANCE_DEPTH - 1}}$`);

/** Longest route key: every level at the longest API ID, plus the separators. */
export const MAX_ROUTE_KEY_LENGTH = MAX_INHERITANCE_DEPTH * (MAX_API_KEY_LENGTH + 1);

/** The route key of a model under its ancestors (root first): `products/digital`. A root's is `routeKeyOf`. */
export const routePathOf = (definition: ModelDefinition, ancestors: readonly ModelDefinition[]): string =>
  [...ancestors, definition].map(routeKeyOf).join('/');

/**
 * Splits the path segments after a content prefix (`/api/content/`) into the route key and the rest: the
 * leading segments that are API IDs (at most MAX_INHERITANCE_DEPTH) form the key; the first one that is not
 * (an entry ID is a UUID, which always has a hyphen) starts the rest. A single segment that already holds a
 * whole route key (`products%2Fdigital`, decoded) is taken as it is. Undefined when no segment is a key.
 * Purely syntactic: shared by the server's URL rewrite and the in-process delivery matcher.
 */
export const splitRoutePath = (
  segments: readonly string[],
): { routeKey: string; rest: string[] } | undefined => {
  const [first] = segments;
  if (first === undefined) {
    return undefined;
  }
  if (!API_KEY_PATTERN.test(first)) {
    return ROUTE_KEY_PATTERN.test(first) ? { routeKey: first, rest: segments.slice(1) } : undefined;
  }
  let count = 1;
  while (
    count < segments.length &&
    count < MAX_INHERITANCE_DEPTH &&
    API_KEY_PATTERN.test(segments[count] as string)
  ) {
    count += 1;
  }
  return { routeKey: segments.slice(0, count).join('/'), rest: segments.slice(count) };
};
