import { Slot } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '@/helpers/cn';

type RowTitleProps = {
  /** Render the child instead (pass a router `Link` to make the title the row's link). */
  asChild?: boolean;
  className?: string;
  children: ReactNode;
};

/** The first cell's title in a list row: ink, 600, cobalt on hover when it's a link. */
export const RowTitle = ({ asChild = false, className, children }: RowTitleProps) => {
  const Comp = asChild ? Slot.Root : 'span';
  return (
    <Comp
      data-slot="row-title"
      className={cn(
        'rounded-sm font-semibold text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 [a&]:hover:text-primary dark:[a&]:hover:text-link',
        className,
      )}
    >
      {children}
    </Comp>
  );
};
