import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME_STATE, migrateThemeState } from './theme';

describe('migrateThemeState', () => {
  it('moves any version 1 preference to Classic with the same appearance', () => {
    for (const preference of ['system', 'light', 'dark'] as const) {
      expect(migrateThemeState({ preference }, 1)).toEqual({
        theme: 'classic',
        appearance: preference,
        variants: ['light', 'dark'],
      });
    }
  });

  it('reads a malformed version 1 value as Classic following the OS', () => {
    expect(migrateThemeState({ preference: 'sepia' }, 1)).toMatchObject({
      theme: 'classic',
      appearance: 'system',
    });
    expect(migrateThemeState(null, 0)).toMatchObject({ theme: 'classic', appearance: 'system' });
  });

  it('keeps a valid version 2 value and repairs a malformed one field by field', () => {
    expect(migrateThemeState({ theme: 'snowed', appearance: 'dark', variants: ['light'] }, 2)).toEqual({
      theme: 'snowed',
      appearance: 'dark',
      variants: ['light'],
    });
    expect(migrateThemeState({ theme: 'BAD KEY', appearance: 'sepia', variants: [] }, 2)).toEqual(
      DEFAULT_THEME_STATE,
    );
  });
});
