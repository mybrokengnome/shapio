import { Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/helpers/cn';

type InfoHintProps = {
  /** What the hint explains (usually the field label): names the button "More about {about}". */
  about: string;
  /** The explanation. Also rendered hidden under `id`, so a control can point `aria-describedby` at it. */
  children: ReactNode;
  /** Set it and add it to the control's `aria-describedby`; the text is then read with the control. */
  id?: string;
  className?: string;
};

/**
 * An explanation behind a 14px info icon next to a label (DESIGN.md, helper-text rule). A popover, not a
 * tooltip: it opens on click, tap and Enter, so touch and keyboard users can read it.
 */
export const InfoHint = ({ about, children, id, className }: InfoHintProps) => {
  const { t } = useTranslation();
  return (
    <>
      <Popover>
        <PopoverTrigger
          type="button"
          aria-label={t('common.moreAbout', { about })}
          className={cn(
            'inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
            className,
          )}
        >
          <Info aria-hidden="true" className="size-3.5" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-3 text-meta">
          {children}
        </PopoverContent>
      </Popover>
      {id ? (
        <span id={id} className="sr-only">
          {children}
        </span>
      ) : null}
    </>
  );
};
