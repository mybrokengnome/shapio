import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { persistentStorage } from '@/helpers/safeStorage';

export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const;

export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export const isThemePreference = (value: string): value is ThemePreference =>
  (THEME_PREFERENCES as readonly string[]).includes(value);

type ThemeState = {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
};

/** Key and shape are read before first paint by public/theme-init.js; keep them in sync. */
export const THEME_STORAGE_KEY = 'shapio.theme';

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      preference: 'system',
      setPreference: (preference) => set({ preference }),
    }),
    { name: THEME_STORAGE_KEY, storage: persistentStorage, version: 1 },
  ),
);
