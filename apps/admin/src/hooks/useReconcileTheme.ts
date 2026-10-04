import { useEffect } from 'react';
import { BOTH_VARIANTS, DEFAULT_THEME_KEY } from '@/constants/themes';
import { useThemeOptions } from '@/hooks/useThemeOptions';
import { useThemeStore } from '@/stores/theme';

/**
 * Once the theme list is known: a saved theme that no longer exists (an extension removed) falls back to
 * Shapio, and the cached variants follow the theme's definition (read before first paint by theme-init.js).
 */
export const useReconcileTheme = () => {
  const { themes, isComplete } = useThemeOptions();
  const theme = useThemeStore((state) => state.theme);
  const variants = useThemeStore((state) => state.variants);
  const setTheme = useThemeStore((state) => state.setTheme);
  useEffect(() => {
    if (!isComplete) {
      return;
    }
    const current = themes.find((option) => option.key === theme);
    if (!current) {
      setTheme(DEFAULT_THEME_KEY, BOTH_VARIANTS);
    } else if (current.variants.join() !== variants.join()) {
      setTheme(current.key, current.variants);
    }
  }, [isComplete, themes, theme, variants, setTheme]);
};
