import { describe, expect, it } from 'vitest';
import { truncate } from './truncate';

describe('truncate', () => {
  it('keeps short text and shortens long text with an ellipsis', () => {
    expect(truncate('short', 10)).toBe('short');
    expect(truncate('a long error message', 8)).toBe('a long…');
    expect(truncate('a long error message', 8)).toHaveLength(7);
  });
});
