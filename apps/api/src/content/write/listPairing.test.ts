import { describe, expect, it } from 'vitest';
import { itemKey, pairList, unseenItemsPolicy, type ListPolicy } from './listPairing.js';

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
    // Nothing the caller cannot write: nothing is compared, every item is new.
    expect(pair('ab', 'ab', { hidden: false, unseen: true })).toEqual({ pairs: [-1, -1], issues: [] });
  });

  it('decides 50,000 items by hashing and set lookups', () => {
    const count = 50_000;
    const keys = Array.from({ length: count }, (_, index) => `k${index}`);
    const result = pairList(
      {
        sentIds: keys.map(() => undefined),
        sent: { keys: [...keys].reverse(), kinds: keys.map(() => 'c') },
        storedIds: keys,
        stored: { keys, kinds: keys.map(() => 'c') },
      },
      hidden,
    );
    expect(result.pairs[0]).toBe(count - 1);
  });
});

describe('pairList without item IDs, for a list that cannot hold hidden values (and admin writes)', () => {
  it.each([
    ['unchanged, look-alikes included', 'aab', 'aab', [0, 1, 2]],
    ['U: edit an item into a copy of another: neither copy is certain', 'pq', 'qq', [-1, -1]],
    ['12b: move and edit: the moved item continues, the edited one is new', 'ab', 'xa', [-1, 0]],
    ['B2: look-alikes moved: only the unique item continues', 'iss', 'ssi', [-1, -1, 0]],
    ['ADM2: [A, B, C] to [A, C2]: C2 is new, never B', 'abc', 'ax', [0, -1]],
    ['edit one item and delete another', 'abc', 'xb', [-1, 1]],
  ])('%s', (_name, stored, sent, pairs) => {
    expect(pair(stored, sent, visible)).toEqual({ pairs, issues: [] });
    expect(pair(stored, sent, { ...hidden, neverRefuses: true })).toEqual({ pairs, issues: [] });
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

  it('treats a stored ID two stored items share as unknown', () => {
    const shared = pairList(
      {
        sentIds: ['a', 'b'],
        sent: { keys: ['q', 'q'], kinds: ['card', 'card'] },
        storedIds: ['a', 'a', 'b'],
        stored: side('xyz'),
      },
      hidden,
    );
    expect(shared).toEqual({ pairs: [-1, 2], issues: [{ index: 0, code: 'UNKNOWN_ITEM_ID' }] });
  });
});

describe('itemKey', () => {
  it('hashes a value nested 200,000 deep without exhausting the stack, keys in any order alike', () => {
    let deep: unknown = 'leaf';
    for (let depth = 0; depth < 200_000; depth += 1) {
      deep = depth % 2 === 0 ? [deep] : { d: deep };
    }
    expect(itemKey({ deep })).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(itemKey({ a: 1, b: { c: 2, d: 3 } })).toBe(itemKey({ b: { d: 3, c: 2 }, a: 1 }));
  });
});
