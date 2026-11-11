import { describe, expect, it } from 'vitest';
import { ALIGNMENT_CELL_BUDGET, alignItems } from './listAlignment.js';
import { pairList, unseenItemsPolicy, type ListPolicy } from './listPairing.js';

/** A list side from item keys (one letter each, all the same component). */
const side = (keys: string) => ({ keys: [...keys], kinds: [...keys].map(() => 'card') });

const hidden: ListPolicy = { hidden: true, unseen: false };
const visible: ListPolicy = { hidden: false, unseen: false };

/** Pairs `sent` with `stored` (keys as letters) without IDs. */
const pair = (stored: string, sent: string, policy = hidden) =>
  pairList(
    {
      sentIds: [...sent].map(() => undefined),
      sent: side(sent),
      storedIds: [...stored].map((_, index) => `s${index}`),
      stored: side(stored),
    },
    policy,
  );

describe('pairList without item IDs (the never-guess table)', () => {
  it.each([
    ['unchanged', 'ab', 'ab', [0, 1]],
    ['unchanged, duplicates included', 'aa', 'aa', [0, 1]],
    ['delete one', 'ab', 'b', [1]],
    ['insert at front', 'ab', 'xab', [-1, 0, 1]],
    ['reorder unique items', 'ab', 'ba', [1, 0]],
    ['edit in place', 'ab', 'xb', [0, 1]],
    ['U: edit in place into a copy of the next item', 'pq', 'qq', [0, 1]],
    ['P: replace the only item (an edit in place)', 'p', 'x', [0]],
    ['12b: move and edit (a delete and a new item)', 'ab', 'xa', [-1, 0]],
    ['delete the first and append a new one', 'pq', 'qx', [1, -1]],
    // Y: `p` was sent at another place, so this is no edit in place: A moved, B and C deleted, two new items.
    ['Y: an old value sent at another place is a move', 'pqq', 'erp', [-1, -1, 0]],
  ])('%s is certain', (_name, stored, sent, pairs) => {
    expect(pair(stored, sent)).toEqual({ pairs, issues: [] });
  });

  it.each([
    ['delete one of two items that look the same', 'aa', 'a'],
    ['duplicate an item', 'a', 'aa'],
    ['edit an item and delete its neighbor', 'abc', 'xc'],
    ['insert next to an edited item', 'a', 'xy'],
    ['reorder with duplicates across a moved item', 'aba', 'aab'],
    ['edit one item and delete another, apart', 'abc', 'xb'],
    ['W: edit, keep, and add with a delete in one gap', 'pq', 'xpn'],
    ['the 742367977 case: one echoed item among look-alikes', 'pqq', 'qppp'],
    ['edit one of two look-alikes while its old value stays', 'qq', 'xq'],
  ])('%s is refused when the items can hold hidden values', (_name, stored, sent) => {
    expect(pair(stored, sent).issues).toEqual([{ index: null, code: 'AMBIGUOUS_ITEMS' }]);
    // Nothing hidden: never refused (its uncertain items are new or edited in place).
    expect(pair(stored, sent, visible).issues).toEqual([]);
  });

  it('refuses a caller that cannot see the stored items, unless it sends nothing (the one named branch)', () => {
    expect(unseenItemsPolicy({ hidden: true, unseen: true }, 1)).toEqual([
      { index: null, code: 'AMBIGUOUS_ITEMS' },
    ]);
    expect(unseenItemsPolicy({ hidden: true, unseen: true }, 0)).toEqual([]);
    expect(unseenItemsPolicy({ hidden: false, unseen: true }, 3)).toEqual([]);
    expect(pair('ab', 'ab', { hidden: true, unseen: true }).issues).toEqual([
      { index: null, code: 'AMBIGUOUS_ITEMS' },
    ]);
  });
});

describe('pairList without item IDs, for a list that cannot hold hidden values', () => {
  it.each([
    ['W', 'pq', 'xpn'],
    ['Y', 'pqq', 'erp'],
    ['the 742367977 case', 'pqq', 'qppp'],
    ['edit one item and delete another', 'abc', 'xb'],
  ])('%s keeps the least-edit alignment and is never refused', (_name, stored, sent) => {
    const { issues, pairs } = pair(stored, sent, visible);
    expect(issues).toEqual([]);
    expect(pairs).toHaveLength(sent.length);
  });
});

describe('pairList with item IDs', () => {
  const stored = { storedIds: ['a', 'b', 'c'], stored: side('xyz') };
  const withIds = (ids: Array<string | null>, kinds = ids.map(() => 'card')) =>
    pairList({ sentIds: ids, sent: { keys: ids.map(() => 'q'), kinds }, ...stored }, hidden);

  it('pairs by ID in any order; null is a new item', () => {
    expect(withIds(['c', null, 'a'])).toEqual({ pairs: [2, -1, 0], issues: [] });
  });

  it('refuses unknown, repeated, and re-typed IDs', () => {
    expect(withIds(['nope']).issues).toEqual([{ index: 0, code: 'UNKNOWN_ITEM_ID' }]);
    expect(withIds(['a', 'a']).issues).toEqual([
      { index: 0, code: 'DUPLICATE_ITEM_ID' },
      { index: 1, code: 'DUPLICATE_ITEM_ID' },
    ]);
    expect(withIds(['b'], ['quote']).issues).toEqual([{ index: 0, code: 'ITEM_COMPONENT_CHANGED' }]);
  });
});

describe('alignItems bounds', () => {
  it('aligns 50,000 identical items with one deleted without filling more than its budget', () => {
    const count = 50_000;
    const stored = {
      keys: Array.from({ length: count }, () => 'k'),
      kinds: Array.from({ length: count }, () => 'c'),
    };
    const sent = { keys: stored.keys.slice(1), kinds: stored.kinds.slice(1) };
    const started = performance.now();
    const result = alignItems(sent, stored);
    expect(result.ambiguous).toBe(true);
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(ALIGNMENT_CELL_BUDGET).toBeLessThan(count * count);
  });

  it('aligns 50,000 unique items, reordered and edited, in linearithmic time', () => {
    const count = 50_000;
    const keys = Array.from({ length: count }, (_, index) => `k${index}`);
    const stored = { keys, kinds: keys.map(() => 'c') };
    const sentKeys = [...keys].reverse();
    sentKeys[10] = 'edited';
    const started = performance.now();
    const result = alignItems({ keys: sentKeys, kinds: sentKeys.map(() => 'c') }, stored);
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(result.pairs[0]).toBe(count - 1);
  });
});
