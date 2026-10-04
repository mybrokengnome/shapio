import { THEME_KEY_PATTERN, THEME_VARIANTS, type ThemeVariant } from '@shapio/schema';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { BUILT_IN_THEMES, DEFAULT_THEME_KEY, DEFAULT_THEME_VARIANTS } from '@/constants/themes';
import { persistentStorage } from '@/helpers/safeStorage';
import { resolveScheme } from '@/helpers/theme';

type ThemeState = {
  /** A theme key: built in (constants/themes.ts) or declared by an extension. */
  theme: string;
  /** The variant of that theme the person picked (a look is one theme in one variant). */
  appearance: ThemeVariant;
  /**
   * The chosen theme's variants, cached so public/theme-init.js can render an extension theme's look before
   * the admin has loaded the theme list.
   */
  variants: readonly ThemeVariant[];
  setLook: (theme: string, appearance: ThemeVariant, variants: readonly ThemeVariant[]) => void;
};

/** Key and shape are read before first paint by public/theme-init.js; keep them in sync. */
export const THEME_STORAGE_KEY = 'shapio.theme';

/** 1: `{ preference }`, before themes. 2: themes plus System / Light / Dark. 3: one look, nothing follows the OS. */
const THEME_STORAGE_VERSION = 3;

type PersistedTheme = Pick<ThemeState, 'theme' | 'appearance' | 'variants'>;

export const DEFAULT_THEME_STATE: PersistedTheme = {
  theme: DEFAULT_THEME_KEY,
  appearance: 'dark',
  variants: DEFAULT_THEME_VARIANTS,
};

/** Version 1 (the original palette, any colour mode) becomes Cobalt, the original dark look. */
const LEGACY_THEME_STATE: PersistedTheme = { theme: 'classic', appearance: 'dark', variants: ['dark'] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isThemeVariant = (value: unknown): value is ThemeVariant =>
  typeof value === 'string' && (THEME_VARIANTS as readonly string[]).includes(value);

export const migrateThemeState = (persisted: unknown, version: number): PersistedTheme =>
  version < 2 ? LEGACY_THEME_STATE : sanitizeThemeState(isRecord(persisted) ? persisted : {});

/**
 * Drops anything malformed (edited storage, an older admin) back to the defaults, field by field. A built-in
 * theme's variants come from the registry, not the cache (they changed in version 3), and the appearance is
 * always a variant the theme has: version 2's "system", or a variant a theme lost, becomes its first.
 */
const sanitizeThemeState = (state: Record<string, unknown>): PersistedTheme => {
  const theme =
    typeof state.theme === 'string' && THEME_KEY_PATTERN.test(state.theme)
      ? state.theme
      : DEFAULT_THEME_STATE.theme;
  const cached = Array.isArray(state.variants)
    ? THEME_VARIANTS.filter((variant) => (state.variants as unknown[]).includes(variant))
    : [];
  const variants =
    BUILT_IN_THEMES.find((meta) => meta.key === theme)?.variants ??
    (cached.length > 0 ? cached : DEFAULT_THEME_STATE.variants);
  const appearance = isThemeVariant(state.appearance) ? state.appearance : (variants[0] ?? 'dark');
  return { theme, appearance: resolveScheme(appearance, variants), variants };
};

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      ...DEFAULT_THEME_STATE,
      setLook: (theme, appearance, variants) => set({ theme, appearance, variants }),
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
