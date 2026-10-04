import { THEME_KEY_PATTERN, THEME_VARIANTS, type ThemeVariant } from '@shapio/schema';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { type Appearance, BOTH_VARIANTS, DEFAULT_THEME_KEY, isAppearance } from '@/constants/themes';
import { persistentStorage } from '@/helpers/safeStorage';

type ThemeState = {
  /** A theme key: built in (constants/themes.ts) or declared by an extension. */
  theme: string;
  appearance: Appearance;
  /**
   * The chosen theme's variants, cached so public/theme-init.js can resolve a single-variant theme (an
   * extension's too) before the admin has loaded the theme list.
   */
  variants: readonly ThemeVariant[];
  setTheme: (theme: string, variants: readonly ThemeVariant[]) => void;
  setAppearance: (appearance: Appearance) => void;
};

/** Key and shape are read before first paint by public/theme-init.js; keep them in sync. */
export const THEME_STORAGE_KEY = 'shapio.theme';

const THEME_STORAGE_VERSION = 2;

type PersistedTheme = Pick<ThemeState, 'theme' | 'appearance' | 'variants'>;

export const DEFAULT_THEME_STATE: PersistedTheme = {
  theme: DEFAULT_THEME_KEY,
  appearance: 'system',
  variants: BOTH_VARIANTS,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/**
 * Version 1 stored `{ preference: 'system' | 'light' | 'dark' }` with the original palette. Anyone who set it
 * keeps that palette (Classic) and that appearance, so nothing changes until they pick a theme.
 */
export const migrateThemeState = (persisted: unknown, version: number): PersistedTheme => {
  const state = isRecord(persisted) ? persisted : {};
  if (version < THEME_STORAGE_VERSION) {
    const preference = typeof state.preference === 'string' ? state.preference : 'system';
    return {
      theme: 'classic',
      appearance: isAppearance(preference) ? preference : 'system',
      variants: BOTH_VARIANTS,
    };
  }
  return sanitizeThemeState(state);
};

/** Drops anything malformed (edited storage, an older admin) back to the defaults, field by field. */
const sanitizeThemeState = (state: Record<string, unknown>): PersistedTheme => {
  const variants = Array.isArray(state.variants)
    ? THEME_VARIANTS.filter((variant) => (state.variants as unknown[]).includes(variant))
    : [];
  return {
    theme:
      typeof state.theme === 'string' && THEME_KEY_PATTERN.test(state.theme)
        ? state.theme
        : DEFAULT_THEME_STATE.theme,
    appearance:
      typeof state.appearance === 'string' && isAppearance(state.appearance)
        ? state.appearance
        : DEFAULT_THEME_STATE.appearance,
    variants: variants.length > 0 ? variants : DEFAULT_THEME_STATE.variants,
  };
};

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      ...DEFAULT_THEME_STATE,
      setTheme: (theme, variants) => set({ theme, variants }),
      setAppearance: (appearance) => set({ appearance }),
    }),
    {
      name: THEME_STORAGE_KEY,
      storage: persistentStorage,
      version: THEME_STORAGE_VERSION,
      migrate: migrateThemeState,
      partialize: ({ theme, appearance, variants }) => ({ theme, appearance, variants }),
      merge: (persisted, current) => ({
        ...current,
        ...sanitizeThemeState(isRecord(persisted) ? persisted : {}),
      }),
    },
  ),
);
