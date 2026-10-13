import { describe, expect, it } from 'vitest';
import { orderAsTree } from './tree';

type Item = { id: string; parent?: string };

const order = (items: Item[]) =>
  orderAsTree(
    items,
    (item) => item.id,
    (item) => item.parent,
  ).map(({ item, depth }) => `${item.id}:${depth}`);

describe('orderAsTree', () => {
  it('puts each child after its parent, depth first, keeping sibling order', () => {
    expect(
      order([
        { id: 'apparel', parent: 'physical' },
        { id: 'articles' },
        { id: 'digital', parent: 'products' },
        { id: 'physical', parent: 'products' },
        { id: 'products' },
      ]),
    ).toEqual(['articles:0', 'products:0', 'digital:1', 'physical:1', 'apparel:2']);
  });

  it('treats a child whose parent is not listed as a root, and survives cycles', () => {
    expect(order([{ id: 'digital', parent: 'elsewhere' }])).toEqual(['digital:0']);
    expect(
      order([
        { id: 'a', parent: 'b' },
        { id: 'b', parent: 'a' },
      ]),
    ).toEqual(['a:0', 'b:1']);
  });
});
