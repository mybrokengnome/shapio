import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildEnvKey, cacheKeyOf } from './cacheKey.js';

describe('cacheKeyOf', () => {
  it('is a 32-character hex digest', () => {
    expect(cacheKeyOf({ title: 'Hello' })).toMatch(/^[0-9a-f]{32}$/);
  });

  it('does not depend on the order of object keys, at any depth', () => {
    expect(cacheKeyOf({ a: 1, b: { c: 2, d: [{ e: 3, f: 4 }] } })).toBe(
      cacheKeyOf({ b: { d: [{ f: 4, e: 3 }], c: 2 }, a: 1 }),
    );
  });

  it('changes when any nested value changes', () => {
    const page = { title: 'Home', sections: [{ heading: 'Hi', image: { url: '/a.webp' } }] };
    const edited = { title: 'Home', sections: [{ heading: 'Hi', image: { url: '/b.webp' } }] };
    expect(cacheKeyOf(page)).not.toBe(cacheKeyOf(edited));
  });

  it('is sensitive to array order', () => {
    expect(cacheKeyOf([1, 2])).not.toBe(cacheKeyOf([2, 1]));
  });

  it('tells its inputs apart (a value moved from one argument to the next is a different key)', () => {
    expect(cacheKeyOf({ a: 1 }, { b: 2 })).not.toBe(cacheKeyOf({ a: 1, b: 2 }));
  });

  it('reads undefined as null and a date as its ISO text', () => {
    expect(cacheKeyOf({ a: undefined })).toBe(cacheKeyOf({ a: null }));
    expect(cacheKeyOf({ at: new Date('2026-10-07T00:00:00.000Z') })).toBe(
      cacheKeyOf({ at: '2026-10-07T00:00:00.000Z' }),
    );
  });

  it('throws on what is not plain data, naming where it is', () => {
    expect(() => cacheKeyOf({ render: () => '' })).toThrow('inputs[0].render is a function');
    expect(() => cacheKeyOf({ id: Symbol('x') })).toThrow('is a symbol');
    expect(() => cacheKeyOf({ size: 1n })).toThrow('is a bigint');
    expect(() => cacheKeyOf({ tags: new Set(['a']) })).toThrow('is a Set');
  });

  it('throws on a value that refers back to itself, but accepts the same object twice', () => {
    const shared = { name: 'Ada' };
    expect(() => cacheKeyOf({ author: shared, editor: shared })).not.toThrow();
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(() => cacheKeyOf(loop)).toThrow('refers back to itself');
  });
});

describe('buildEnvKey', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('carries drafts mode and the year, which a page shows without reading them from its data', () => {
    vi.stubEnv('SHAPIO_DRAFTS', 'true');
    expect(buildEnvKey()).toEqual({ drafts: true, year: new Date().getFullYear() });
    vi.stubEnv('SHAPIO_DRAFTS', '');
    expect(buildEnvKey().drafts).toBe(false);
  });
});
