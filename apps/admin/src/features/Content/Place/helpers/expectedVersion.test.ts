import { describe, expect, it } from 'vitest';
import { expectedVersionOf } from './expectedVersion';

describe('expectedVersionOf', () => {
  it('guards a row read in the published locale, or any row of a model that is not localized', () => {
    expect(expectedVersionOf({ id: 'e1', locale: 'fr', version: 4 }, 'fr')).toBe(4);
    expect(expectedVersionOf({ id: 'e1', locale: 'en', version: 2 }, null)).toBe(2);
  });

  it('leaves a row read from a fallback locale unguarded', () => {
    expect(expectedVersionOf({ id: 'e1', locale: 'en', version: 2 }, 'fr')).toBeUndefined();
  });
});
