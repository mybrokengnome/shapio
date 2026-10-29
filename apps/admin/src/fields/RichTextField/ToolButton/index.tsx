import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/helpers/cn';
import { formatShortcut } from '@/helpers/formatShortcut';

type ToolButtonProps = {
  icon: LucideIcon;
  label: string;
  /** Tiptap's keys ("Mod+Shift+8"), shown in the platform's own words. */
  keys?: string;
  /** A second line in the tooltip, for behavior the button alone doesn't show. */
  hint?: string;
  pressed?: boolean;
  disabled: boolean;
  onClick: () => void;
};

/** A toolbar button with its label (and keyboard shortcut) in a tooltip; `pressed` shows active formatting. */
export const ToolButton = ({
  icon: Icon,
  label,
  keys,
  hint,
  pressed,
  disabled,
  onClick,
}: ToolButtonProps) => {
  const { t } = useTranslation();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-pressed={pressed}
          disabled={disabled}
          className="aria-pressed:bg-accent aria-pressed:text-accent-foreground"
          onClick={onClick}
        >
          <Icon aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent className={cn(hint && 'max-w-60')}>
        {keys ? t('content.richText.shortcut', { action: label, keys: formatShortcut(keys) }) : label}
        {hint ? <span className="block font-normal opacity-80">{hint}</span> : null}
      </TooltipContent>
    </Tooltip>
  );
};
