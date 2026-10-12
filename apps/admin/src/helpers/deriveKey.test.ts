import { describe, expect, it } from 'vitest';
import { ROLE_KEY_PATTERN } from '@/features/Settings/Roles/constants';
import { deriveKey } from './deriveKey';

describe('deriveKey', () => {
  it('makes a valid key from a name', () => {
    expect(deriveKey('Marketing team')).toBe('marketing-team');
    expect(deriveKey('Équipe Café')).toBe('equipe-cafe');
    expect(deriveKey('2026 Launch!')).toBe('launch');
    expect(deriveKey('x'.repeat(70))).toHaveLength(63);
    expect(ROLE_KEY_PATTERN.test(deriveKey('Story reviewers (EU)'))).toBe(true);
  });

  it('is empty when the name has no letters', () => {
    expect(deriveKey('2026')).toBe('');
  });
});
