import { describe, expect, it } from 'vitest';
import { buildPlaceTree, flattenPlaces, type PlaceSource } from './placeTree';

const source = (
  id: string,
  count: number | undefined,
  kind: PlaceSource['kind'] = 'collection',
): PlaceSource => ({
  id,
  apiKey: id,
  label: id[0]?.toUpperCase() + id.slice(1),
  kind,
  count,
  canCreate: true,
  shared: false,
});

/** product > (physical > apparel), digital; settings is a single type. */
const ANCESTORS: Record<string, string[]> = {
  digital: ['product'],
  physical: ['product'],
  apparel: ['product', 'physical'],
};
const ancestors = (id: string) => ANCESTORS[id] ?? [];

describe('buildPlaceTree', () => {
  it('nests kinds under their parent and sorts each level', () => {
    const roots = buildPlaceTree(
      [
        source('settings', undefined, 'singleton'),
        source('physical', 6),
        source('apparel', 4),
        source('product', 10),
        source('digital', 3),
        source('author', 5),
      ],
      ancestors,
    );
    expect(roots.map((place) => place.id)).toEqual(['author', 'product', 'settings']);
    const product = roots[1];
    expect(product?.count).toBe(10);
    expect(product?.children.map((place) => [place.id, place.parentId, place.count])).toEqual([
      ['digital', 'product', 3],
      ['physical', 'product', 6],
    ]);
    expect(flattenPlaces(roots).map((place) => place.id)).toEqual([
      'author',
      'product',
      'digital',
      'physical',
      'apparel',
      'settings',
    ]);
  });

  it('nests a kind under its nearest readable ancestor, or makes it a root', () => {
    const roots = buildPlaceTree(
      [source('apparel', 1), source('product', 1), source('digital', 1)],
      ancestors,
    );
    expect(roots.map((place) => place.id)).toEqual(['product']);
    expect(roots[0]?.children.map((place) => place.id)).toEqual(['apparel', 'digital']);
    expect(buildPlaceTree([source('apparel', 1)], ancestors).map((place) => place.id)).toEqual(['apparel']);
  });
});
