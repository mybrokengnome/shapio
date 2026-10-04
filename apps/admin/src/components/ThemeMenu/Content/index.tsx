import { useTranslation } from 'react-i18next';
import { DropdownMenuLabel } from '@/components/ui/dropdown-menu';
import { ThemeMenuThemes } from '../Themes';

/** The looks under a Theme label: the body of the theme menu and the account menu's Theme item. */
export const ThemeMenuContent = () => {
  const { t } = useTranslation();
  return (
    <>
      <DropdownMenuLabel>{t('theme.label')}</DropdownMenuLabel>
      <ThemeMenuThemes />
    </>
  );
};
