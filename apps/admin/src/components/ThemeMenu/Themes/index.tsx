import { useTranslation } from 'react-i18next';
import { DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@/components/ui/dropdown-menu';
import { ThemeSwatches } from '../../ThemeSwatches';
import { useLookSelection } from '../hooks/useLookSelection';

/** The looks as radio items with their colours, for any dropdown menu (the theme menu, the account menu). */
export const ThemeMenuThemes = () => {
  const { t } = useTranslation();
  const { looks, selectedLook, selectLook } = useLookSelection();
  return (
    <DropdownMenuRadioGroup aria-label={t('theme.label')} value={selectedLook} onValueChange={selectLook}>
      {looks.map((look) => (
        <DropdownMenuRadioItem key={look.value} value={look.value}>
          <ThemeSwatches themeKey={look.themeKey} variant={look.variant} />
          {look.name}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
};
