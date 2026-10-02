import { describe, expect, it } from 'vitest';
import { lowerFirst } from './lowerFirst';

describe('lowerFirst', () => {
  it('lowercases only the first letter', () => {
    expect(lowerFirst('Signed in', 'en')).toBe('signed in');
    expect(lowerFirst('Created API token', 'en')).toBe('created API token');
    expect(lowerFirst('', 'en')).toBe('');
  });
});
