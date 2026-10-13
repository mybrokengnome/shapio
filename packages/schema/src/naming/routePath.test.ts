import { describe, expect, it } from 'vitest';
import { MAX_INHERITANCE_DEPTH } from '../inheritance/resolve.js';
import { id, model } from '../testing/fixtures.js';
import { MAX_ROUTE_KEY_LENGTH, ROUTE_KEY_PATTERN, routePathOf, splitRoutePath } from './routePath.js';

const uuid = id(42);

describe('routePathOf', () => {
  it('joins the ancestors’ route keys and the model’s', () => {
    const products = model({ apiKey: 'product', pluralApiKey: 'products' });
    const digital = model({ apiKey: 'digitalProduct', pluralApiKey: 'digital' });
    expect(routePathOf(digital, [products])).toBe('products/digital');
    expect(routePathOf(products, [])).toBe('products');
  });
});

describe('ROUTE_KEY_PATTERN', () => {
  it(`accepts one to ${MAX_INHERITANCE_DEPTH} API IDs joined by /`, () => {
    expect(ROUTE_KEY_PATTERN.test('products')).toBe(true);
    expect(ROUTE_KEY_PATTERN.test('products/digital/ebooks')).toBe(true);
    expect(ROUTE_KEY_PATTERN.test(Array(MAX_INHERITANCE_DEPTH).fill('a').join('/'))).toBe(true);
    expect(
      ROUTE_KEY_PATTERN.test(
        Array(MAX_INHERITANCE_DEPTH + 1)
          .fill('a')
          .join('/'),
      ),
    ).toBe(false);
    expect(ROUTE_KEY_PATTERN.test('products/')).toBe(false);
    expect(ROUTE_KEY_PATTERN.test(uuid)).toBe(false);
  });

  it('allows the longest keys', () => {
    expect(MAX_ROUTE_KEY_LENGTH).toBe(MAX_INHERITANCE_DEPTH * 65);
  });
});

describe('splitRoutePath', () => {
  it('takes the leading API IDs as the key and stops at an entry ID', () => {
    expect(splitRoutePath(['products'])).toEqual({ routeKey: 'products', rest: [] });
    expect(splitRoutePath(['products', 'digital'])).toEqual({ routeKey: 'products/digital', rest: [] });
    expect(splitRoutePath(['products', 'digital', uuid, 'publish'])).toEqual({
      routeKey: 'products/digital',
      rest: [uuid, 'publish'],
    });
    expect(splitRoutePath(['products', uuid])).toEqual({ routeKey: 'products', rest: [uuid] });
  });

  it('accepts a whole key in one decoded segment', () => {
    expect(splitRoutePath(['products/digital', uuid])).toEqual({
      routeKey: 'products/digital',
      rest: [uuid],
    });
  });

  it('stops after the level limit and refuses a path that starts with no key', () => {
    const many = Array(MAX_INHERITANCE_DEPTH + 1).fill('a');
    expect(splitRoutePath(many)?.rest).toEqual(['a']);
    expect(splitRoutePath([uuid])).toBeUndefined();
    expect(splitRoutePath([])).toBeUndefined();
  });
});
