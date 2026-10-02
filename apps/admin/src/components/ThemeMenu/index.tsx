import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { THEME_ICONS } from '@/constants/themeIcons';
import { useThemeStore } from '@/stores/theme';
import { ThemeOptions } from './Options';

/** Compact theme switcher for screens without the account menu (sign-in, setup). */
export const ThemeMenu = () => {
  const { t } = useTranslation();
  const preference = useThemeStore((state) => state.preference);
  const Icon = THEME_ICONS[preference];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('theme.toggle')}>
          <Icon aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t('theme.label')}</DropdownMenuLabel>
        <ThemeOptions />
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
