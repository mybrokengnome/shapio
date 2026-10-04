import { Globe2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/helpers/cn';

type SharedGlyphProps = {
  /**
   * Inside a link or button that names its target: the glyph is hidden from assistive technology and the
   * control carries "Shared with all sites" as its description instead (so its name stays the label).
   */
  decorative?: boolean;
  className?: string;
};

/** A small globe beside a content type or component shared with all sites, explained on hover. */
export const SharedGlyph = ({ decorative = false, className }: SharedGlyphProps) => {
  const { t } = useTranslation();
  const label = t('contentTypes.sharedWithAllSites');
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
          data-shared
          className={cn('inline-flex shrink-0 items-center text-muted-foreground', className)}
        >
          <Globe2 aria-hidden="true" className="size-3.5" />
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
};
