// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import type { ThemeVariant } from '@shapio/schema';
import { afterEach, describe, expect, it } from 'vitest';
import { APPEARANCES } from '@/constants/themes';
import { resolveScheme } from '@/helpers/theme';
import { migrateThemeState, THEME_STORAGE_KEY } from '@/stores/theme';
import { SRC_DIR } from './sourceFiles';

/** public/theme-init.js (plain JS, before first paint) must agree with the store and resolveScheme. */
const SCRIPT = readFileSync(join(SRC_DIR, '..', 'public', 'theme-init.js'), 'utf8');

/** Runs the script as the browser would: against this page's window and document. */
const executeScript = () => {
  runInNewContext(SCRIPT, { window, document });
};

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

afterEach(() => {
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.classList.remove('dark');
  window.localStorage.clear();
});

const VARIANT_SETS: ReadonlyArray<readonly ThemeVariant[]> = [['light', 'dark'], ['light'], ['dark']];
const CASES = ['shapio', 'classic', 'murdered-out', 'snowed', 'acme-night'].flatMap((theme) =>
  VARIANT_SETS.flatMap((variants) =>
    APPEARANCES.flatMap((appearance) =>
      [true, false].map((systemDark) => ({ theme, variants, appearance, systemDark })),
    ),
  ),
);

describe('public/theme-init.js', () => {
  it.each(CASES)(
    '$theme $variants $appearance (OS dark: $systemDark) matches resolveScheme',
    ({ theme, variants, appearance, systemDark }) => {
      const stored = { state: { theme, appearance, variants }, version: 2 };
      expect(runScript(stored, systemDark)).toEqual({
        theme,
        dark: resolveScheme(appearance, variants, systemDark) === 'dark',
      });
    },
  );

  it.each(
    APPEARANCES.flatMap((preference) => [true, false].map((systemDark) => ({ preference, systemDark }))),
  )(
    'reads a version 1 value ($preference, OS dark: $systemDark) as the store migrates it',
    ({ preference, systemDark }) => {
      const migrated = migrateThemeState({ preference }, 1);
      expect(migrated.theme).toBe('classic');
      expect(runScript({ state: { preference }, version: 1 }, systemDark)).toEqual({
        theme: 'classic',
        dark: resolveScheme(migrated.appearance, migrated.variants, systemDark) === 'dark',
      });
    },
  );

  it('defaults to Shapio following the OS when nothing is stored', () => {
    expect(runScript(undefined, true)).toEqual({ theme: 'shapio', dark: true });
    expect(runScript(undefined, false)).toEqual({ theme: 'shapio', dark: false });
  });

  it('ignores a malformed theme key and appearance', () => {
    const stored = {
      state: { theme: "x'] {", appearance: 'sepia', variants: ['light', 'dark'] },
      version: 2,
    };
    expect(runScript(stored, true)).toEqual({ theme: 'shapio', dark: true });
  });

  it('survives unreadable storage', () => {
    stubSystemDark(false);
    window.localStorage.setItem(THEME_STORAGE_KEY, '{not json');
    executeScript();
    expect(document.documentElement.getAttribute('data-theme')).toBe('shapio');
  });
});
