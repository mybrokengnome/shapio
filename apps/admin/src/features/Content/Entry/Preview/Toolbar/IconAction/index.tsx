import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

type IconActionProps = { label: string; icon: ReactNode; onClick: () => void };

/** A small icon button of the preview pane's toolbar, named by its label (also its tooltip). */
export const IconAction = ({ label, icon, onClick }: IconActionProps) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={label} onClick={onClick}>
        {icon}
      </Button>
    </TooltipTrigger>
    <TooltipContent>{label}</TooltipContent>
  </Tooltip>
);
