import { describe, expect, it } from 'vitest';
import { writeOrder } from './order.js';
import type { ImportEntry, SourceFields } from './types.js';

const entry = (sourceId: string, fields: SourceFields = {}): ImportEntry => ({
  sourceId,
  definition: 'post',
  title: sourceId,
  locales: [{ locale: null, fields, published: true }],
});
const ref = (...sourceIds: string[]) => ({ kind: 'entries' as const, sourceIds, many: sourceIds.length > 1 });

describe('writeOrder', () => {
  it('creates referenced entries first', () => {
    const order = writeOrder([
      entry('post:1', { author: ref('author:a'), tags: ref('tag:x', 'tag:y') }),
      entry('tag:y'),
      entry('author:a'),
      entry('tag:x'),
    ]);
    const ids = order.entries.map((item) => item.sourceId);
    expect(ids.indexOf('author:a')).toBeLessThan(ids.indexOf('post:1'));
    expect(ids.indexOf('tag:x')).toBeLessThan(ids.indexOf('post:1'));
    expect(ids.indexOf('tag:y')).toBeLessThan(ids.indexOf('post:1'));
    expect(order.deferred.size).toBe(0);
  });

  it('defers the field that closes a cycle, including references nested in components', () => {
    const order = writeOrder([
      entry('a', { partner: ref('b') }),
      entry('b', { seo: { kind: 'component', many: false, items: [{ related: ref('a') }] } }),
      entry('self', { parent: ref('self') }),
    ]);
    expect(order.entries.map((item) => item.sourceId)).toEqual(['b', 'a', 'self']);
    expect(order.deferred).toEqual(
      new Map([
        ['b', new Set(['seo'])],
        ['self', new Set(['parent'])],
      ]),
    );
  });

  it('ignores references to entries outside the import', () => {
    const order = writeOrder([entry('p', { author: ref('missing') })]);
    expect(order.entries.map((item) => item.sourceId)).toEqual(['p']);
    expect(order.deferred.size).toBe(0);
  });

  it('handles long parent chains without recursion', () => {
    const chain = Array.from({ length: 20_000 }, (_, index) =>
      entry(`page:${index}`, index > 0 ? { parent: ref(`page:${index - 1}`) } : {}),
    ).reverse();
    const order = writeOrder(chain);
    expect(order.entries[0]?.sourceId).toBe('page:0');
    expect(order.entries.at(-1)?.sourceId).toBe('page:19999');
  });
});
