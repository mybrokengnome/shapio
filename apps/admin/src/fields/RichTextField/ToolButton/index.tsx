import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

type ToolButtonProps = {
  icon: LucideIcon;
  label: string;
  keys?: string;
  pressed?: boolean;
  disabled: boolean;
  onClick: () => void;
};

/** A toolbar button with its label (and keyboard shortcut) in a tooltip; `pressed` shows active formatting. */
export const ToolButton = ({ icon: Icon, label, keys, pressed, disabled, onClick }: ToolButtonProps) => {
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
      <TooltipContent>
        {keys ? t('content.richText.shortcut', { action: label, keys }) : label}
      </TooltipContent>
    </Tooltip>
  );
};
