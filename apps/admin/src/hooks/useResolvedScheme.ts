import type { ThemeVariant } from '@shapio/schema';
import { resolveScheme } from '@/helpers/theme';
import { useSystemPrefersDark } from '@/hooks/useSystemPrefersDark';
import { useThemeStore } from '@/stores/theme';

/** The variant rendered now (light or dark): the saved appearance, the OS's, or a single-variant theme's own. */
export const useResolvedScheme = (): ThemeVariant => {
  const appearance = useThemeStore((state) => state.appearance);
  const variants = useThemeStore((state) => state.variants);
  const systemPrefersDark = useSystemPrefersDark();
  return resolveScheme(appearance, variants, systemPrefersDark);
};
