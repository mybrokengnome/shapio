import { Globe, Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/helpers/cn';

type ScopeIconProps = { localized: boolean; className?: string };

/**
 * The document's quiet version of `ScopeBadge`: a 14px icon saying whether a value is per locale or shared
 * by every locale (ADR 0004). Its name is in a tooltip and in text for screen readers.
 */
export const ScopeIcon = ({ localized, className }: ScopeIconProps) => {
  const { t } = useTranslation();
  const Icon = localized ? Languages : Globe;
  const label = localized ? t('content.scope.localized') : t('content.scope.sharedHint');
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn('inline-flex shrink-0 text-muted-foreground [&_svg]:size-3.5', className)}
          data-scope={localized ? 'localized' : 'shared'}
        >
          <Icon aria-hidden="true" />
          <span className="sr-only">{label}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
};
