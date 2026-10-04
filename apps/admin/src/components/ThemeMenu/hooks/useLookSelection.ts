import { useCallback } from 'react';
import { lookValue, resolveScheme } from '@/helpers/theme';
import { useLookOptions } from '@/hooks/useLookOptions';
import { useThemeStore } from '@/stores/theme';

/** The looks, the chosen one's radio value, and a picker that saves the look (and its theme's variants). */
export const useLookSelection = () => {
  const { looks } = useLookOptions();
  const theme = useThemeStore((state) => state.theme);
  const appearance = useThemeStore((state) => state.appearance);
  const variants = useThemeStore((state) => state.variants);
  const setLook = useThemeStore((state) => state.setLook);
  const selectedLook = lookValue(theme, resolveScheme(appearance, variants));
  const selectLook = useCallback(
    (value: string) => {
      const look = looks.find((candidate) => candidate.value === value);
      if (look) {
        setLook(look.themeKey, look.variant, look.variants);
      }
    },
    [looks, setLook],
  );
  return { looks, selectedLook, selectLook };
};
