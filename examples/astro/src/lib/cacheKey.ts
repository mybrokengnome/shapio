import { createHash } from 'node:crypto';
import { isDraftsMode } from './config.js';

/**
 * Keys for Astro's incremental build (`experimental.incrementalBuild` in astro.config.mjs). A page returned by
 * `getStaticPaths()` with a `cacheKey` is restored from the previous build, not rendered, when its key and its
 * code (Astro hashes the page's import graph) are both unchanged. So the key must cover every piece of data the
 * page renders: its props, what the layout reads (`layoutInputs`), and the build environment (`buildEnvKey`).
 * Whole objects go in, never a hand-picked list of fields, which would drift from what the page renders.
 */

/** Plain data in a stable form: object keys sorted, arrays in order, `undefined` as null, dates as ISO text. */
const normalize = (value: unknown, path: string, seen: Set<object>): unknown => {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    throw new TypeError(`cacheKeyOf: ${path} is a ${typeof value}, not plain data`);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  const object = value;
  if (seen.has(object)) {
    throw new TypeError(`cacheKeyOf: ${path} refers back to itself`);
  }
  seen.add(object);
  try {
    if (Array.isArray(object)) {
      return object.map((item, index) => normalize(item, `${path}[${index}]`, seen));
    }
    const prototype = Object.getPrototypeOf(object) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`cacheKeyOf: ${path} is a ${object.constructor.name}, not plain data`);
    }
    const entries = Object.entries(object).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([key, item]) => [key, normalize(item, `${path}.${key}`, seen)]));
  } finally {
    seen.delete(object);
  }
};

/** A stable digest of the data a page renders: same inputs, same key, whatever the order of object keys. */
export const cacheKeyOf = (...inputs: unknown[]): string =>
  createHash('sha256')
    .update(JSON.stringify(normalize(inputs, 'inputs', new Set())))
    .digest('hex')
    .slice(0, 32);

/**
 * What a page shows that comes from neither its data nor its code: settings read from the environment and the
 * clock when it renders, which Astro's code and config hashes do not see.
 */
export const buildEnvKey = () => ({ drafts: isDraftsMode(), year: new Date().getFullYear() });
