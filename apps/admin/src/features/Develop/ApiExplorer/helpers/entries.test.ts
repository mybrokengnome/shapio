import { describe, expect, it } from 'vitest';
import { responseEntries } from './entries';

describe('responseEntries', () => {
  it('reads a list or a single entry, with a title-like label', () => {
    expect(
      responseEntries({
        data: [
          { id: 'a', locale: 'en', title: 'Hello', __model: 'post' },
          { id: 'b', name: 'Bob' },
          { nope: 1 },
        ],
      }),
    ).toEqual([
      { id: 'a', locale: 'en', label: 'Hello', model: 'post' },
      { id: 'b', locale: undefined, label: 'Bob', model: undefined },
    ]);
    expect(responseEntries({ data: { id: 'c' } })).toEqual([
      { id: 'c', locale: undefined, label: undefined, model: undefined },
    ]);
  });

  it('finds nothing in errors or non-JSON bodies', () => {
    expect(responseEntries({ error: { code: 'NOT_FOUND' } })).toEqual([]);
    expect(responseEntries('Not Found')).toEqual([]);
  });
});
