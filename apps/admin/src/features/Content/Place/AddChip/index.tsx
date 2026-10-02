import { Plus } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '@/helpers/cn';

type AddChipProps = Omit<ComponentProps<'button'>, 'type'>;

/** A dashed "+ Status" chip that opens a quick filter (a menu or picker as its trigger). */
export const AddChip = ({ className, children, ...props }: AddChipProps) => (
  <button
    type="button"
    className={cn(
      'inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-input px-3 text-xs font-medium text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
      className,
    )}
    {...props}
  >
    <Plus aria-hidden="true" className="size-3.5" />
    {children}
  </button>
);
