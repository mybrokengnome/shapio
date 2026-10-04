import { useEffect } from 'react';
import { DEFAULT_THEME_KEY, DEFAULT_THEME_VARIANTS } from '@/constants/themes';
import { resolveScheme } from '@/helpers/theme';
import { useThemeOptions } from '@/hooks/useThemeOptions';
import { useThemeStore } from '@/stores/theme';

/**
 * Once the theme list is known: a saved theme that no longer exists (an extension removed) falls back to
 * Shapio, and the cached variants follow the theme's definition (read before first paint by theme-init.js),
 * keeping the saved variant when the theme still has it.
 */
export const useReconcileTheme = () => {
  const { themes, isComplete } = useThemeOptions();
  const theme = useThemeStore((state) => state.theme);
  const appearance = useThemeStore((state) => state.appearance);
  const variants = useThemeStore((state) => state.variants);
  const setLook = useThemeStore((state) => state.setLook);
  useEffect(() => {
    if (!isComplete) {
      return;
    }
    const current = themes.find((option) => option.key === theme);
    if (!current) {
      setLook(DEFAULT_THEME_KEY, resolveScheme(appearance, DEFAULT_THEME_VARIANTS), DEFAULT_THEME_VARIANTS);
    } else if (current.variants.join() !== variants.join()) {
      setLook(current.key, resolveScheme(appearance, current.variants), current.variants);
    }
  }, [isComplete, themes, theme, appearance, variants, setLook]);
};
