import { useCallback } from 'react';
import { oppositeTheme, resolveTheme } from '@/helpers/theme';
import { useSystemPrefersDark } from '@/hooks/useSystemPrefersDark';
import { useThemeStore } from '@/stores/theme';

/**
 * The rendered theme and a switch to its opposite. The switch saves an explicit Light or Dark preference in
 * the theme store, so the account menu's Theme options show the same choice.
 */
export const useResolvedThemeAndToggle = () => {
  const preference = useThemeStore((state) => state.preference);
  const setPreference = useThemeStore((state) => state.setPreference);
  const systemPrefersDark = useSystemPrefersDark();
  const resolvedTheme = resolveTheme(preference, systemPrefersDark);
  const toggleTheme = useCallback(
    () => setPreference(oppositeTheme(resolvedTheme)),
    [resolvedTheme, setPreference],
  );
  return { resolvedTheme, toggleTheme };
};
