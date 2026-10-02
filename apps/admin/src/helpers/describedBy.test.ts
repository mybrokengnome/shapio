import { describe, expect, it } from 'vitest';
import { describedBy } from './describedBy';

describe('describedBy', () => {
  it('joins the ids that are set', () => {
    expect(describedBy('a-hint', undefined, false, 'a-error')).toBe('a-hint a-error');
  });

  it('is undefined when nothing describes the control', () => {
    expect(describedBy(undefined, null, false)).toBeUndefined();
  });
});
