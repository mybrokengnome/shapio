import { describe, expect, it } from 'vitest';
import { parseJsonText } from './http.js';

describe('parseJsonText', () => {
  it('reads plain, fenced and prose-wrapped JSON objects', () => {
    expect(parseJsonText('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonText('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonText('Here you go:\n{"a":{"b":2}}\nThanks')).toEqual({ a: { b: 2 } });
    expect(parseJsonText('no json')).toBeUndefined();
  });
});
