import { Kind } from 'graphql';
import { describe, expect, it } from 'vitest';
import { createInt53Scalar } from './fixedTypes.js';

describe('Int53', () => {
  const int53 = createInt53Scalar();

  it('carries every safe integer as a JSON number', () => {
    expect(int53.serialize(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    expect(int53.serialize(-Number.MAX_SAFE_INTEGER)).toBe(-Number.MAX_SAFE_INTEGER);
    expect(int53.parseValue(3_000_000_000)).toBe(3_000_000_000);
    expect(int53.parseLiteral({ kind: Kind.INT, value: '9007199254740991' })).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('rejects fractions, unsafe integers and non-numbers', () => {
    expect(() => int53.serialize(1.5)).toThrow();
    expect(() => int53.parseValue(2 ** 53)).toThrow();
    expect(() => int53.parseValue('12')).toThrow();
    expect(() => int53.parseLiteral({ kind: Kind.INT, value: '9007199254740993' })).toThrow();
    expect(() => int53.parseLiteral({ kind: Kind.FLOAT, value: '1.0' })).toThrow();
  });
});
