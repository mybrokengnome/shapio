import type { ThemeVariant } from '@shapio/schema';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { lookValue } from '@/helpers/theme';
import { useThemeOptions } from '@/hooks/useThemeOptions';

export type LookOption = {
  /** `<theme key>:<variant>`, the radio value. */
  value: string;
  themeKey: string;
  variant: ThemeVariant;
  /** The theme's variants, cached in the theme store for the pre-paint script. */
  variants: readonly ThemeVariant[];
  name: string;
  description: string | undefined;
};

/**
 * Every look the person can pick, in menu order: one per theme variant. A one-variant theme (every built-in
 * one) is listed by its name; an extension theme with both variants twice, as "Name Light" and "Name Dark".
 */
export const useLookOptions = (): { looks: readonly LookOption[] } => {
  const { t } = useTranslation();
  const { themes } = useThemeOptions();
  const looks = useMemo(
    () =>
      themes.flatMap((theme) =>
        theme.variants.map((variant): LookOption => ({
          value: lookValue(theme.key, variant),
          themeKey: theme.key,
          variant,
          variants: theme.variants,
          name:
            theme.variants.length > 1
              ? t('appearance.lookName', { theme: theme.name, variant: t(`appearance.variants.${variant}`) })
              : theme.name,
          description: theme.description,
        })),
      ),
    [t, themes],
  );
  return { looks };
};
