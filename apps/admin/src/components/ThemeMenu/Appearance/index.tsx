import { useTranslation } from 'react-i18next';
import {
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu';
import { THEME_ICONS } from '@/constants/themeIcons';
import { APPEARANCES, isAppearance } from '@/constants/themes';
import { useThemeStore } from '@/stores/theme';
import { useSingleVariantNote } from '../hooks/useSingleVariantNote';
import { useThemeSelection } from '../hooks/useThemeSelection';

/**
 * System / Light / Dark as radio items. A single-variant theme ignores them: they are disabled and a note
 * says why.
 */
export const ThemeMenuAppearance = () => {
  const { t } = useTranslation();
  const appearance = useThemeStore((state) => state.appearance);
  const setAppearance = useThemeStore((state) => state.setAppearance);
  const { isSingleVariant } = useThemeSelection();
  const note = useSingleVariantNote();
  return (
    <>
      <DropdownMenuLabel>{t('appearance.mode')}</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        aria-label={t('appearance.mode')}
        value={appearance}
        onValueChange={(value) => {
          if (isAppearance(value)) {
            setAppearance(value);
          }
        }}
      >
        {APPEARANCES.map((option) => {
          const OptionIcon = THEME_ICONS[option];
          return (
            <DropdownMenuRadioItem key={option} value={option} disabled={isSingleVariant}>
              <OptionIcon aria-hidden="true" />
              {t(`theme.${option}`)}
            </DropdownMenuRadioItem>
          );
        })}
      </DropdownMenuRadioGroup>
      {note ? (
        <p className="max-w-56 px-2 pb-1.5 text-xs text-muted-foreground" data-slot="appearance-note">
          {note}
        </p>
      ) : null}
    </>
  );
};
