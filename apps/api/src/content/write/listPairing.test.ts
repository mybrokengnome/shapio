import { describe, expect, it } from 'vitest';
import { ALIGNMENT_CELL_BUDGET, alignItems, newAlignmentBudget } from './listAlignment.js';
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
    newAlignmentBudget(),
  );

const AMBIGUOUS = [{ index: null, code: 'AMBIGUOUS_ITEMS' }];

describe('pairList without item IDs, for a list that can hold hidden values (the never-guess rule)', () => {
  it.each([
    ['unchanged', 'ab', 'ab', [0, 1]],
    ['unchanged, look-alikes included', 'aa', 'aa', [0, 1]],
    ['reorder distinct items', 'abc', 'cab', [2, 0, 1]],
    ['delete one', 'abc', 'ac', [0, 2]],
    ['delete and reorder', 'abc', 'ca', [2, 0]],
    ['add at the front', 'ab', 'xab', [-1, 0, 1]],
    ['add and reorder', 'ab', 'bxa', [1, -1, 0]],
    ['delete everything but one', 'abc', 'b', [1]],
    ['delete several distinct items', 'abcd', 'bd', [1, 3]],
    ['nothing stored: every item is new, look-alikes included', '', 'aab', [-1, -1, -1]],
  ])('%s is accepted', (_name, stored, sent, pairs) => {
    expect(pair(stored, sent)).toEqual({ pairs, issues: [] });
  });

  it.each([
    ['U: edit an item into a copy of another', 'pq', 'qq'],
    ['P: replace the only item', 'p', 'x'],
    ['12b: move and edit', 'ab', 'xa'],
    ['Y: edit two, move one', 'pqq', 'erp'],
    ['X2: look-alikes stored, edited', 'pqq', 'erp'],
    ['AB: swap and edit both', 'pq', 'xy'],
    ['edit in place', 'ab', 'xb'],
    ['delete one and add one', 'pq', 'qx'],
    ['delete one of two look-alikes', 'aa', 'a'],
    ['duplicate an item', 'a', 'aa'],
    ['B2: reorder with look-alikes [Intro, S, S] to [S, S, Intro]', 'iss', 'ssi'],
    ['B2: [S, A, S, B] to [A, B, S, S]', 'sasb', 'abss'],
    ['B2: [B, A] to [A, B, B]', 'ba', 'abb'],
    ['B2: [B, B, A] to [A, B]', 'bba', 'ab'],
    ['W: edit, keep, and add', 'pq', 'xpn'],
    ['742367977: one echoed among look-alikes', 'pqq', 'qppp'],
  ])('%s needs IDs', (_name, stored, sent) => {
    expect(pair(stored, sent).issues).toEqual(AMBIGUOUS);
  });

  it('refuses a caller that cannot see the stored items, unless it sends nothing (the one named branch)', () => {
    expect(unseenItemsPolicy({ hidden: true, unseen: true }, 1)).toEqual(AMBIGUOUS);
    expect(unseenItemsPolicy({ hidden: true, unseen: true }, 0)).toEqual([]);
    expect(unseenItemsPolicy({ hidden: false, unseen: true }, 3)).toEqual([]);
    expect(pair('ab', 'ab', { hidden: true, unseen: true }).issues).toEqual(AMBIGUOUS);
  });

  it('decides 50,000 items in linear time', () => {
    const count = 50_000;
    const keys = Array.from({ length: count }, (_, index) => `k${index}`);
    const started = performance.now();
    const result = pairList(
      {
        sentIds: keys.map(() => undefined),
        sent: { keys: [...keys].reverse(), kinds: keys.map(() => 'c') },
        storedIds: keys,
        stored: { keys, kinds: keys.map(() => 'c') },
      },
      hidden,
      newAlignmentBudget(),
    );
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(result.pairs[0]).toBe(count - 1);
  });
});

describe('pairList without item IDs, for a list that cannot hold hidden values', () => {
  it.each([
    ['U', 'pq', 'qq'],
    ['12b', 'ab', 'xa'],
    ['B2', 'iss', 'ssi'],
    ['edit one item and delete another', 'abc', 'xb'],
  ])('%s keeps the least-edit alignment (for IDs only) and is never refused', (_name, stored, sent) => {
    const { issues, pairs } = pair(stored, sent, visible);
    expect(issues).toEqual([]);
    expect(pairs).toHaveLength(sent.length);
  });

  it('shares one alignment budget across every list of a write', () => {
    const budget = newAlignmentBudget();
    const keys = (n: number, prefix: string) => Array.from({ length: n }, (_, index) => `${prefix}${index}`);
    // Lists that need a full table: once the budget is spent, the rest align in place, at no cost.
    const size = Math.ceil(Math.sqrt(ALIGNMENT_CELL_BUDGET)) - 1;
    for (let list = 0; list < 5; list += 1) {
      const stored = keys(size, 's');
      const sent = keys(size - 1, 't');
      alignItems(
        { keys: sent, kinds: sent.map(() => 'c') },
        { keys: stored, kinds: stored.map(() => 'c') },
        budget,
      );
    }
    expect(budget.cells).toBeLessThan(ALIGNMENT_CELL_BUDGET / 2);
  });
});

describe('pairList with item IDs', () => {
  const stored = { storedIds: ['a', 'b', 'c'], stored: side('xyz') };
  const withIds = (ids: Array<string | null>, kinds = ids.map(() => 'card')) =>
    pairList(
      { sentIds: ids, sent: { keys: ids.map(() => 'q'), kinds }, ...stored },
      hidden,
      newAlignmentBudget(),
    );

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
