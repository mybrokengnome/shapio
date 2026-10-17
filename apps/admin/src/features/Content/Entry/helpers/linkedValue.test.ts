import { describe, expect, it } from 'vitest';
import { linkedValueOf } from './linkedValue';

describe('linkedValueOf', () => {
  it('reads the field to go to from the hash, and the linked entry from ?target=', () => {
    expect(linkedValueOf('related', 'e1')).toEqual({ path: '/related', entryId: 'e1' });
    expect(linkedValueOf('#sections/2/title', undefined)).toEqual({ path: '/sections/2/title' });
    expect(linkedValueOf('', 'e1')).toBeUndefined();
  });
});
