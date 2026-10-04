// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import type { ThemeVariant } from '@shapio/schema';
import { afterEach, describe, expect, it } from 'vitest';
import { BUILT_IN_THEMES } from '@/constants/themes';
import { resolveScheme } from '@/helpers/theme';
import { migrateThemeState, THEME_STORAGE_KEY } from '@/stores/theme';
import { SRC_DIR } from './sourceFiles';

/** public/theme-init.js (plain JS, before first paint) must agree with the store and resolveScheme. */
const SCRIPT = readFileSync(join(SRC_DIR, '..', 'public', 'theme-init.js'), 'utf8');

/** Runs the script as the browser would: against this page's window and document. */
const executeScript = () => {
  runInNewContext(SCRIPT, { window, document });
};

/** The OS preference must never matter: every case runs with the OS asking for dark and for light. */
const stubSystemDark = (matches: boolean) => {
  Object.defineProperty(window, 'matchMedia', {
    value: (query: string) => ({ matches, media: query }) as MediaQueryList,
    configurable: true,
    writable: true,
  });
};

const runScript = (stored: unknown, systemDark: boolean) => {
  stubSystemDark(systemDark);
  if (stored === undefined) {
    window.localStorage.removeItem(THEME_STORAGE_KEY);
  } else {
    window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(stored));
  }
  executeScript();
  const root = document.documentElement;
  return { theme: root.getAttribute('data-theme'), dark: root.classList.contains('dark') };
};

/** What the store makes of a stored value (it migrates on load), rendered as the admin would. */
const expected = (stored: { state: unknown; version: number }) => {
  const migrated = migrateThemeState(stored.state, stored.version);
  return { theme: migrated.theme, dark: resolveScheme(migrated.appearance, migrated.variants) === 'dark' };
};

afterEach(() => {
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.classList.remove('dark');
  window.localStorage.clear();
});

const VARIANT_SETS: ReadonlyArray<readonly ThemeVariant[]> = [['light', 'dark'], ['light'], ['dark']];
const THEME_KEYS = [...BUILT_IN_THEMES.map(({ key }) => key), 'acme-night'];
const CASES = [2, 3].flatMap((version) =>
  THEME_KEYS.flatMap((theme) =>
    VARIANT_SETS.flatMap((variants) =>
      ['system', 'light', 'dark'].flatMap((appearance) =>
        [true, false].map((systemDark) => ({ version, theme, variants, appearance, systemDark })),
      ),
    ),
  ),
);

describe('public/theme-init.js', () => {
  it.each(CASES)(
    'v$version $theme $variants $appearance (OS dark: $systemDark) matches the store',
    ({ version, theme, variants, appearance, systemDark }) => {
      const stored = { state: { theme, appearance, variants }, version };
      expect(runScript(stored, systemDark)).toEqual(expected(stored));
    },
  );

  it.each(
    ['system', 'light', 'dark'].flatMap((preference) =>
      [true, false].map((systemDark) => ({ preference, systemDark })),
    ),
  )('reads a version 1 value ($preference, OS dark: $systemDark) as Cobalt', ({ preference, systemDark }) => {
    const stored = { state: { preference }, version: 1 };
    expect(expected(stored)).toEqual({ theme: 'classic', dark: true });
    expect(runScript(stored, systemDark)).toEqual({ theme: 'classic', dark: true });
  });

  it('defaults to Shapio (dark) when nothing is stored, whatever the OS says', () => {
    expect(runScript(undefined, true)).toEqual({ theme: 'shapio', dark: true });
    expect(runScript(undefined, false)).toEqual({ theme: 'shapio', dark: true });
  });

  it('ignores a malformed theme key and appearance', () => {
    const stored = {
      state: { theme: "x'] {", appearance: 'sepia', variants: ['light', 'dark'] },
      version: 3,
    };
    expect(runScript(stored, false)).toEqual({ theme: 'shapio', dark: true });
  });

  it('survives unreadable storage', () => {
    stubSystemDark(false);
    window.localStorage.setItem(THEME_STORAGE_KEY, '{not json');
    executeScript();
    expect(document.documentElement.getAttribute('data-theme')).toBe('shapio');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
