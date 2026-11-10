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
