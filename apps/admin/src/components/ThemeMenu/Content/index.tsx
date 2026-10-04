import { useTranslation } from 'react-i18next';
import { DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { ThemeMenuAppearance } from '../Appearance';
import { ThemeMenuThemes } from '../Themes';

/** Theme list, then the appearance options: the body of the theme menu and the account menu's Theme item. */
export const ThemeMenuContent = () => {
  const { t } = useTranslation();
  return (
    <>
      <DropdownMenuLabel>{t('theme.label')}</DropdownMenuLabel>
      <ThemeMenuThemes />
      <DropdownMenuSeparator />
      <ThemeMenuAppearance />
    </>
  );
};
