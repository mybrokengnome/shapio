import type { ResolvedModelDefinition } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { kindFilterChoices, kindFilterOf, withKindFilter } from './kindFilter';

const kind = (apiKey: string, ancestorIds: string[]) =>
  ({ id: apiKey, apiKey, label: apiKey, ancestorIds }) as unknown as ResolvedModelDefinition;

/** Products > Digital, Physical > Apparel, in tree order (as usePlaceKinds gives them). */
const PRODUCT = kind('product', []);
const DIGITAL = kind('digital', ['product']);
const PHYSICAL = kind('physical', ['product']);
const APPAREL = kind('apparel', ['product', 'physical']);
const FAMILY = [PRODUCT, DIGITAL, PHYSICAL, APPAREL];

describe('kindFilterChoices', () => {
  it('offers the type first, then every kind, and nothing for a type without kinds', () => {
    expect(kindFilterChoices(FAMILY).map((choice) => choice.apiKey)).toEqual([
      'product',
      'digital',
      'physical',
      'apparel',
    ]);
    expect(kindFilterChoices([PRODUCT])).toEqual([]);
  });

  it("offers a kind's own family when the place is that kind", () => {
    expect(kindFilterChoices([PHYSICAL, APPAREL]).map((choice) => choice.apiKey)).toEqual([
      'physical',
      'apparel',
    ]);
  });
});

describe('kindFilterOf', () => {
  it('narrows to the type alone', () => {
    expect(kindFilterOf(FAMILY, 'product')).toEqual({ __model: { $eq: 'product' } });
  });

  it('narrows to a kind without kinds', () => {
    expect(kindFilterOf(FAMILY, 'digital')).toEqual({ __model: { $eq: 'digital' } });
  });

  it('narrows to a kind and the kinds under it', () => {
    expect(kindFilterOf(FAMILY, 'physical')).toEqual({ __model: { $in: ['physical', 'apparel'] } });
  });

  it('ignores a kind outside the family or none', () => {
    expect(kindFilterOf(FAMILY, 'author')).toBeUndefined();
    expect(kindFilterOf(FAMILY, undefined)).toBeUndefined();
  });
});

describe('withKindFilter', () => {
  it('puts the kind filter beside the list filter, at the top level', () => {
    const list = { price: { $gte: 10 } };
    const kindOnly = { __model: { $eq: 'digital' } };
    expect(withKindFilter(list, kindOnly)).toEqual({ price: { $gte: 10 }, __model: { $eq: 'digital' } });
    const both = { $and: [list, { name: { $eq: 'A' } }] };
    expect(withKindFilter(both, kindOnly)).toEqual({ ...both, __model: { $eq: 'digital' } });
    expect(withKindFilter(undefined, kindOnly)).toBe(kindOnly);
    expect(withKindFilter(list, undefined)).toBe(list);
  });
});
