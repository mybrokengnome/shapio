import { useCallback } from 'react';
import { hasSingleVariant } from '@/helpers/theme';
import { type ThemeOption, useThemeOptions } from '@/hooks/useThemeOptions';
import { useThemeStore } from '@/stores/theme';

/**
 * The theme list, the chosen theme (if it is still offered), whether it ignores the appearance setting, and
 * a picker that caches the theme's variants for the pre-paint script.
 */
export const useThemeSelection = () => {
  const { themes } = useThemeOptions();
  const themeKey = useThemeStore((state) => state.theme);
  const variants = useThemeStore((state) => state.variants);
  const setTheme = useThemeStore((state) => state.setTheme);
  const current: ThemeOption | undefined = themes.find((option) => option.key === themeKey);
  const selectTheme = useCallback(
    (key: string) => {
      const option = themes.find((candidate) => candidate.key === key);
      if (option) {
        setTheme(option.key, option.variants);
      }
    },
    [themes, setTheme],
  );
  return { themes, themeKey, current, isSingleVariant: hasSingleVariant(variants), selectTheme };
};
