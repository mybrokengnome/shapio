import { describe, expect, it } from 'vitest';
import { nestsDeeperThan } from './jsonDepth.js';

const nested = (levels: number): unknown => {
  let value: unknown = 1;
  for (let level = 1; level < levels; level += 1) {
    value = level % 2 === 0 ? [value] : { a: value };
  }
  return value;
};

describe('nestsDeeperThan', () => {
  it('counts levels as JSON_DEPTH does', () => {
    expect(nestsDeeperThan(1, 1)).toBe(false);
    expect(nestsDeeperThan({}, 1)).toBe(false);
    expect(nestsDeeperThan({ a: 1 }, 1)).toBe(true);
    expect(nestsDeeperThan({ a: 1 }, 2)).toBe(false);
    expect(nestsDeeperThan(nested(64), 64)).toBe(false);
    expect(nestsDeeperThan(nested(65), 64)).toBe(true);
  });

  it('never walks into anything but arrays and plain objects (a streamed body)', () => {
    class Node {
      next: unknown = { a: { b: { c: 1 } } };
    }
    expect(nestsDeeperThan({ body: new Node() }, 2)).toBe(false);
  });

  it('walks 200,000 levels without exhausting the stack', () => {
    expect(nestsDeeperThan(nested(200_000), 64)).toBe(true);
  });
});
