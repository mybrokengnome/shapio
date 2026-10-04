import { Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/helpers/cn';
import { useResolvedSchemeAndToggle } from '../hooks/useResolvedSchemeAndToggle';
import { useSingleVariantNote } from '../hooks/useSingleVariantNote';

type ThemeToggleProps = { className?: string };

/**
 * One-click light ⇄ dark switch (sidebar footer, phone bar). Shows the variant it switches to. For a
 * single-variant theme it is unavailable (aria-disabled, still focusable) and its tooltip says why.
 */
export const ThemeToggle = ({ className }: ThemeToggleProps) => {
  const { t } = useTranslation();
  const { resolvedScheme, toggleScheme } = useResolvedSchemeAndToggle();
  const lockedReason = useSingleVariantNote();
  const isDark = resolvedScheme === 'dark';
  const Icon = isDark ? Sun : Moon;
  const label = lockedReason ?? (isDark ? t('shell.theme.switchToLight') : t('shell.theme.switchToDark'));
  const button = (
    <Button
      variant="ghost"
      size="icon-sm"
      className={cn('aria-disabled:cursor-not-allowed aria-disabled:opacity-50', className)}
      aria-label={label}
      aria-disabled={lockedReason ? true : undefined}
      onClick={lockedReason ? undefined : toggleScheme}
    >
      <Icon aria-hidden="true" />
    </Button>
  );
  if (!lockedReason) {
    return button;
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{lockedReason}</TooltipContent>
    </Tooltip>
  );
};
