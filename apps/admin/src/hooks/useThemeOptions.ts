import type { ThemeVariant } from '@shapio/schema';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useExtensionThemes } from '@/api/extensionThemes';
import { BUILT_IN_THEMES } from '@/constants/themes';

export type ThemeOption = {
  key: string;
  name: string;
  description: string | undefined;
  variants: readonly ThemeVariant[];
};

/**
 * Every theme the person can pick, in menu order: the built-in ones (translated), then the project's.
 * `isComplete` is false until the project's list has loaded (or while it fails): nothing may be judged
 * missing from the list before then.
 */
export const useThemeOptions = (): { themes: readonly ThemeOption[]; isComplete: boolean } => {
  const { t } = useTranslation();
  const extensionThemes = useExtensionThemes();
  const themes = useMemo(
    () => [
      ...BUILT_IN_THEMES.map(({ key, variants }): ThemeOption => ({
        key,
        name: t(`appearance.themes.${key}.name`),
        description: t(`appearance.themes.${key}.description`),
        variants,
      })),
      ...(extensionThemes.data?.items ?? []).map(({ key, name, description, variants }): ThemeOption => ({
        key,
        name,
        description,
        variants,
      })),
    ],
    [t, extensionThemes.data],
  );
  return { themes, isComplete: extensionThemes.isSuccess };
};
