import { canonicalJson } from './itemIds.js';

/**
 * Whether two content values are the same: equal JSON, whatever the key order, at any depth without recursion
 * (`isDeepStrictEqual` recurses, so a deeply nested json value would exhaust the stack). Inside a value, a key holding
 * `undefined` counts as absent, as it does once stored; `undefined` itself equals only `undefined`.
 */
export const sameContent = (left: unknown, right: unknown): boolean =>
  left === right ||
  (left !== undefined && right !== undefined && canonicalJson(left) === canonicalJson(right));
