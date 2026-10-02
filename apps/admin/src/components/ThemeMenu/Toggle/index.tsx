import { Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useResolvedThemeAndToggle } from '../hooks/useResolvedThemeAndToggle';

type ThemeToggleProps = { className?: string };

/** One-click light ⇄ dark switch (sidebar footer, phone bar). Shows the theme it switches to. */
export const ThemeToggle = ({ className }: ThemeToggleProps) => {
  const { t } = useTranslation();
  const { resolvedTheme, toggleTheme } = useResolvedThemeAndToggle();
  const isDark = resolvedTheme === 'dark';
  const Icon = isDark ? Sun : Moon;
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={className}
      aria-label={isDark ? t('shell.theme.switchToLight') : t('shell.theme.switchToDark')}
      onClick={toggleTheme}
    >
      <Icon aria-hidden="true" />
    </Button>
  );
};
