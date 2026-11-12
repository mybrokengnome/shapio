import { describe, expect, it } from 'vitest';
import { createLru, createSegmentedLru } from './lru.js';

describe('createLru', () => {
  it('drops the least recently used entry past its capacity', () => {
    const lru = createLru<string, number>(2);
    lru.set('a', 1);
    lru.set('b', 2);
    expect(lru.get('a')).toBe(1);
    lru.set('c', 3);
    expect(lru.get('b')).toBeUndefined();
    expect(lru.get('a')).toBe(1);
    expect(lru.get('c')).toBe(3);
    expect(lru.size).toBe(2);
  });

  it('replaces an entry in place and clears', () => {
    const lru = createLru<string, number>(2);
    lru.set('a', 1);
    lru.set('a', 2);
    expect(lru.get('a')).toBe(2);
    expect(lru.size).toBe(1);
    lru.clear();
    expect(lru.size).toBe(0);
  });
});

describe('createSegmentedLru', () => {
  it('keeps entries read again while one-off entries churn among themselves', () => {
    const lru = createSegmentedLru<string, number>({ probation: 2, protected: 2 });
    lru.set('hot', 1);
    expect(lru.get('hot')).toBe(1);
    for (let oneOff = 0; oneOff < 100; oneOff += 1) {
      lru.set(`one-off-${oneOff}`, oneOff);
    }
    expect(lru.has('hot')).toBe(true);
    expect(lru.entries()).toEqual([
      ['one-off-98', 98, 'probation'],
      ['one-off-99', 99, 'probation'],
      ['hot', 1, 'protected'],
    ]);
  });

  it('evicts protected entries only to make room for other promoted ones, back into probation', () => {
    const lru = createSegmentedLru<string, number>({ probation: 2, protected: 1 });
    lru.set('a', 1);
    lru.get('a');
    lru.set('b', 2);
    lru.get('b');
    expect(lru.entries()).toEqual([
      ['a', 1, 'probation'],
      ['b', 2, 'protected'],
    ]);
    expect(lru.has('a')).toBe(true);
    lru.delete('b');
    lru.clear();
    expect(lru.size).toBe(0);
  });

  it('has does not count as a use', () => {
    const lru = createSegmentedLru<string, number>({ probation: 1, protected: 1 });
    lru.set('a', 1);
    lru.has('a');
    lru.set('b', 2);
    expect(lru.has('a')).toBe(false);
  });
});

describe('createSegmentedLru with a weight budget', () => {
  const weighted = () =>
    createSegmentedLru<string, number>(
      { probation: 10, protected: 10 },
      { weigh: (_key, value) => value, maxWeight: 10 },
    );

  it('evicts probation first, then protected, until within the budget', () => {
    const lru = weighted();
    lru.set('p', 4);
    expect(lru.get('p')).toBe(4); // protected
    lru.set('a', 3);
    lru.set('b', 3);
    expect(lru.weight).toBe(10);
    lru.set('c', 3);
    // Over by 3: probation's oldest ('a') leaves.
    expect(lru.has('a')).toBe(false);
    expect(lru.weight).toBe(10);
    lru.set('d', 9);
    // Probation empties first, then protected's oldest goes too.
    expect(lru.has('p')).toBe(false);
    expect(lru.has('d')).toBe(true);
    expect(lru.weight).toBe(9);
  });

  it('accounts replacements, deletes and clears, and never stores an entry heavier than the budget', () => {
    const lru = weighted();
    lru.set('a', 2);
    lru.set('a', 5);
    expect(lru.weight).toBe(5);
    lru.delete('a');
    expect(lru.weight).toBe(0);
    lru.set('big', 11);
    expect(lru.has('big')).toBe(false);
    expect(lru.weight).toBe(0);
    lru.set('b', 1);
    lru.clear();
    expect(lru.weight).toBe(0);
    expect(lru.size).toBe(0);
  });
});
