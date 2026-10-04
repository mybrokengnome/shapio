import type { ThemeVariant } from '@shapio/schema';
import { resolveScheme } from '@/helpers/theme';
import { useThemeStore } from '@/stores/theme';

/** The variant rendered now (light or dark): the saved look's, or the theme's own if it lost that variant. */
export const useResolvedScheme = (): ThemeVariant => {
  const appearance = useThemeStore((state) => state.appearance);
  const variants = useThemeStore((state) => state.variants);
  return resolveScheme(appearance, variants);
};
