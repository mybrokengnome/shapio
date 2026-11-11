/** Parsed JSON containers only: arrays and plain objects (never a stream, buffer, or other class instance). */
const isContainer = (value: unknown): value is object => {
  if (Array.isArray(value)) {
    return true;
  }
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === null || prototype === Object.prototype;
};

/**
 * Whether a parsed JSON value nests deeper than `limit` (`JSON_DEPTH` counting: a scalar or an empty container is
 * 1), walked without recursion and stopping at the first container past the limit.
 */
export const nestsDeeperThan = (value: unknown, limit: number): boolean => {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 1 }];
  for (let next = stack.pop(); next; next = stack.pop()) {
    if (next.depth > limit) {
      return true;
    }
    const current = next.value;
    if (!isContainer(current)) {
      continue;
    }
    const members: unknown[] = Array.isArray(current) ? current : Object.values(current);
    for (const member of members) {
      stack.push({ value: member, depth: next.depth + 1 });
    }
  }
  return false;
};
