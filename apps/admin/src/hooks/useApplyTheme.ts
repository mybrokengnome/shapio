import { useEffect } from 'react';
import { useResolvedScheme } from '@/hooks/useResolvedScheme';
import { useThemeStore } from '@/stores/theme';

/**
 * Keeps `data-theme` and the `dark` class on <html> in step with the saved theme and appearance (and, for
 * "system", the OS setting). public/theme-init.js sets the same before first paint.
 */
export const useApplyTheme = () => {
  const theme = useThemeStore((state) => state.theme);
  const scheme = useResolvedScheme();
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.classList.toggle('dark', scheme === 'dark');
  }, [theme, scheme]);
};
