import { QUERY_LIMITS, queryInvalid } from './types.js';

/**
 * Bracket querystrings (`filters[title][$eq]=x`, `filters[$or][0][slug][$eq]=y`, `fields[0]=title`) to a
 * nested object of strings. Lists stay objects with numeric keys here; `parse.ts` decides where a list is
 * expected. Bounded in parameter count, depth and length so a hostile query cannot cost much.
 */
export type QueryTree = { [key: string]: QueryValue };
export type QueryValue = string | string[] | QueryTree;

const SEGMENT = /^\[([^[\]]*)\]/;
const MAX_DEPTH = 10;
const MAX_KEY_LENGTH = 300;

const splitKey = (key: string): string[] => {
  const open = key.indexOf('[');
  if (open === -1) {
    return [key];
  }
  const segments = [key.slice(0, open)];
  let rest = key.slice(open);
  while (rest.length > 0) {
    const match = SEGMENT.exec(rest);
    if (!match) {
      throw queryInvalid(`Malformed query parameter "${key}"`);
    }
    segments.push(match[1] as string);
    rest = rest.slice(match[0].length);
  }
  return segments;
};

const isTree = (value: QueryValue | undefined): value is QueryTree =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const assign = (tree: QueryTree, segments: readonly string[], value: string, key: string) => {
  let node = tree;
  segments.forEach((segment, index) => {
    if (segment === '' || segment === '__proto__' || segment === 'constructor' || segment === 'prototype') {
      throw queryInvalid(`Malformed query parameter "${key}"`);
    }
    const last = index === segments.length - 1;
    const existing = Object.hasOwn(node, segment) ? node[segment] : undefined;
    if (last) {
      if (existing === undefined) {
        node[segment] = value;
      } else if (typeof existing === 'string') {
        node[segment] = [existing, value];
      } else if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        throw queryInvalid(`Query parameter "${key}" conflicts with another parameter`);
      }
      return;
    }
    if (existing === undefined) {
      const child: QueryTree = Object.create(null) as QueryTree;
      node[segment] = child;
      node = child;
    } else if (isTree(existing)) {
      node = existing;
    } else {
      throw queryInvalid(`Query parameter "${key}" conflicts with another parameter`);
    }
  });
};

export const parseQueryTree = (search: string): QueryTree => {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const tree: QueryTree = Object.create(null) as QueryTree;
  let count = 0;
  for (const [key, value] of params) {
    count += 1;
    if (count > QUERY_LIMITS.maxParameters) {
      throw queryInvalid(`At most ${QUERY_LIMITS.maxParameters} query parameters are allowed`);
    }
    if (key.length > MAX_KEY_LENGTH || value.length > QUERY_LIMITS.maxValueLength) {
      throw queryInvalid('A query parameter is too long');
    }
    const segments = splitKey(key);
    if (segments.length > MAX_DEPTH) {
      throw queryInvalid(`Query parameter "${key}" is nested too deeply`);
    }
    assign(tree, segments, value, key);
  }
  return tree;
};

/** A list value: repeated parameters, `a,b` comma lists, or `[0]`, `[1]`… keys. */
export const toList = (value: QueryValue | undefined, { commas = true } = {}): QueryValue[] => {
  if (value === undefined) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'string') {
    return commas ? value.split(',').filter((item) => item.length > 0) : [value];
  }
  const keys = Object.keys(value);
  if (!keys.every((key) => /^\d+$/.test(key))) {
    throw queryInvalid('Expected a list');
  }
  return keys.sort((a, b) => Number(a) - Number(b)).map((key) => value[key] as QueryValue);
};
