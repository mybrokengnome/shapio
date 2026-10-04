import { useTranslation } from 'react-i18next';
import { useThemeSelection } from './useThemeSelection';

/** Why the appearance setting does nothing for the chosen theme, or undefined when it applies. */
export const useSingleVariantNote = (): string | undefined => {
  const { t } = useTranslation();
  const { current, isSingleVariant } = useThemeSelection();
  if (!isSingleVariant || !current) {
    return undefined;
  }
  return current.variants[0] === 'dark'
    ? t('appearance.onlyDark', { theme: current.name })
    : t('appearance.onlyLight', { theme: current.name });
};
