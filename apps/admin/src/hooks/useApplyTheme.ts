import { useEffect } from 'react';
import { useThemeStore } from '@/stores/theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** Keeps the `dark` class on <html> in sync with the saved preference and, for "system", the OS setting. */
export const useApplyTheme = () => {
  const preference = useThemeStore((state) => state.preference);
  useEffect(() => {
    const media = window.matchMedia(DARK_QUERY);
    const apply = () => {
      const dark = preference === 'dark' || (preference === 'system' && media.matches);
      document.documentElement.classList.toggle('dark', dark);
    };
    apply();
    if (preference !== 'system') {
      return undefined;
    }
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [preference]);
};
