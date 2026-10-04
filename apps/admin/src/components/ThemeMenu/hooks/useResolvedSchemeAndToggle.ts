import { useCallback } from 'react';
import { oppositeScheme } from '@/helpers/theme';
import { useResolvedScheme } from '@/hooks/useResolvedScheme';
import { useThemeStore } from '@/stores/theme';

/**
 * The rendered variant and a switch to its opposite. The switch saves an explicit Light or Dark appearance
 * in the theme store, so the account menu's Appearance options show the same choice.
 */
export const useResolvedSchemeAndToggle = () => {
  const setAppearance = useThemeStore((state) => state.setAppearance);
  const resolvedScheme = useResolvedScheme();
  const toggleScheme = useCallback(
    () => setAppearance(oppositeScheme(resolvedScheme)),
    [resolvedScheme, setAppearance],
  );
  return { resolvedScheme, toggleScheme };
};
