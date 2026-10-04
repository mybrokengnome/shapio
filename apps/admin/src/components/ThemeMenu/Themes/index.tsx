import { useTranslation } from 'react-i18next';
import { DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@/components/ui/dropdown-menu';
import { ThemeSwatches } from '../../ThemeSwatches';
import { useThemeSelection } from '../hooks/useThemeSelection';

/** The themes as radio items with their colours, for any dropdown menu (the theme menu, the account menu). */
export const ThemeMenuThemes = () => {
  const { t } = useTranslation();
  const { themes, themeKey, selectTheme } = useThemeSelection();
  return (
    <DropdownMenuRadioGroup aria-label={t('theme.label')} value={themeKey} onValueChange={selectTheme}>
      {themes.map((option) => (
        <DropdownMenuRadioItem key={option.key} value={option.key}>
          <ThemeSwatches themeKey={option.key} variants={option.variants} />
          {option.name}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
};
