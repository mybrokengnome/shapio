import { Globe, Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/helpers/cn';

type ScopeBadgeProps = { localized: boolean };

const CHIP_CLASSES =
  'inline-flex h-5 items-center gap-1 rounded-full px-2 text-2xs font-semibold [&_svg]:size-3 [&_svg]:shrink-0';

/**
 * In a localized model, says whether a field is per locale or shared by every locale of the entry. Shared
 * fields explain themselves on click (saving one changes every locale's draft, ADR 0004).
 */
export const ScopeBadge = ({ localized }: ScopeBadgeProps) => {
  const { t } = useTranslation();
  if (localized) {
    return (
      <span className={cn(CHIP_CLASSES, 'bg-accent text-accent-foreground')}>
        <Languages aria-hidden="true" />
        {t('content.scope.localized')}
      </span>
    );
  }
  return (
    <Popover>
      <PopoverTrigger
        type="button"
        className={cn(
          CHIP_CLASSES,
          'border text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
        )}
      >
        <Globe aria-hidden="true" />
        {t('content.scope.shared')}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3 text-meta">
        {t('content.scope.sharedHint')}
      </PopoverContent>
    </Popover>
  );
};
