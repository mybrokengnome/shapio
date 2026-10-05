import { Plus } from 'lucide-react';
import type { ComponentProps } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/helpers/cn';

type AddItemButtonProps = Omit<ComponentProps<typeof Button>, 'children' | 'size' | 'variant'> & {
  /** "Add Text item", "Add section". */
  label: string;
  /** `outline` in forms and empty states; `ghost` at the end of a canvas list, like the canvas's own `+`. */
  variant?: 'outline' | 'ghost';
};

/**
 * Adds to a list (or fills an empty single component). Passes its other props to the button, so it can be
 * a menu's trigger (`asChild`).
 */
export const AddItemButton = ({ label, variant = 'outline', className, ...props }: AddItemButtonProps) => (
  <Button
    type="button"
    variant={variant}
    size="sm"
    className={cn(variant === 'ghost' && '-ml-2 text-muted-foreground', className)}
    {...props}
  >
    <Plus aria-hidden="true" />
    {label}
  </Button>
);
