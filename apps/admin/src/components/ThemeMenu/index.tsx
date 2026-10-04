import { Palette } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ThemeMenuContent } from './Content';

/** Compact theme switcher for screens without the account menu (sign-in, setup). */
export const ThemeMenu = () => {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('theme.toggle')}>
          <Palette aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <ThemeMenuContent />
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
