import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME_STATE, migrateThemeState } from './theme';

describe('migrateThemeState', () => {
  it('moves any version 1 value to Cobalt (the original dark look)', () => {
    for (const persisted of [
      { preference: 'system' },
      { preference: 'light' },
      { preference: 'sepia' },
      null,
    ]) {
      expect(migrateThemeState(persisted, 1)).toEqual({
        theme: 'classic',
        appearance: 'dark',
        variants: ['dark'],
      });
    }
    expect(migrateThemeState(null, 0)).toMatchObject({ theme: 'classic', appearance: 'dark' });
  });

  it('moves a version 2 built-in theme to its one look, whatever the colour mode was', () => {
    for (const appearance of ['system', 'light', 'dark']) {
      expect(migrateThemeState({ theme: 'shapio', appearance, variants: ['light', 'dark'] }, 2)).toEqual({
        theme: 'shapio',
        appearance: 'dark',
        variants: ['dark'],
      });
    }
    expect(migrateThemeState({ theme: 'snowed', appearance: 'system', variants: ['light'] }, 2)).toEqual({
      theme: 'snowed',
      appearance: 'light',
      variants: ['light'],
    });
  });

  it("keeps an extension theme's variant; version 2's System becomes its first variant", () => {
    expect(migrateThemeState({ theme: 'sepia', appearance: 'dark', variants: ['light', 'dark'] }, 3)).toEqual(
      {
        theme: 'sepia',
        appearance: 'dark',
        variants: ['light', 'dark'],
      },
    );
    expect(
      migrateThemeState({ theme: 'sepia', appearance: 'system', variants: ['light', 'dark'] }, 2),
    ).toEqual({
      theme: 'sepia',
      appearance: 'light',
      variants: ['light', 'dark'],
    });
  });

  it('repairs a malformed value field by field', () => {
    expect(migrateThemeState({ theme: 'BAD KEY', appearance: 'sepia', variants: [] }, 3)).toEqual(
      DEFAULT_THEME_STATE,
    );
  });
});
