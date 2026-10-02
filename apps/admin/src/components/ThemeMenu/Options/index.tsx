import { useTranslation } from 'react-i18next';
import { DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@/components/ui/dropdown-menu';
import { THEME_ICONS } from '@/constants/themeIcons';
import { isThemePreference, THEME_PREFERENCES, useThemeStore } from '@/stores/theme';

/** System / Light / Dark as radio items, for any dropdown menu (the theme menu, the account menu). */
export const ThemeOptions = () => {
  const { t } = useTranslation();
  const preference = useThemeStore((state) => state.preference);
  const setPreference = useThemeStore((state) => state.setPreference);
  return (
    <DropdownMenuRadioGroup
      value={preference}
      onValueChange={(value) => {
        if (isThemePreference(value)) {
          setPreference(value);
        }
      }}
    >
      {THEME_PREFERENCES.map((option) => {
        const OptionIcon = THEME_ICONS[option];
        return (
          <DropdownMenuRadioItem key={option} value={option}>
            <OptionIcon aria-hidden="true" />
            {t(`theme.${option}`)}
          </DropdownMenuRadioItem>
        );
      })}
    </DropdownMenuRadioGroup>
  );
};
