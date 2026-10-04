import { cva } from 'class-variance-authority';
import type { LucideIcon } from 'lucide-react';
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import { type ReactNode, useId } from 'react';
import { cn } from '@/helpers/cn';
import { IconTile } from '../IconTile';

const tileVariants = cva(
  'group/tile relative flex w-full cursor-pointer text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        /** A selectable card: icon on top, name and one-line description (a few side by side). */
        card: 'flex-col items-start gap-2.5 rounded-xl border bg-card p-3.5 hover:border-primary/40 hover:bg-muted/40 data-[state=checked]:border-primary data-[state=checked]:bg-accent data-[state=checked]:hover:bg-accent dark:data-[state=checked]:bg-primary/5 dark:data-[state=checked]:hover:bg-primary/5',
        /** A compact square tile for dense grids: icon over the name, centred; the description is announced only. */
        tile: 'flex-col items-center justify-center gap-1.5 rounded-lg border bg-card px-2 py-2.5 text-center hover:border-primary/40 hover:bg-muted/40 data-[state=checked]:border-primary data-[state=checked]:bg-accent data-[state=checked]:hover:bg-accent dark:data-[state=checked]:bg-primary/5 dark:data-[state=checked]:hover:bg-primary/5',
        /** A compact list row with a left accent bar when selected. */
        row: 'items-center gap-2.5 rounded-md px-3 py-1.5 text-sm text-foreground/85 before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-primary before:opacity-0 hover:bg-muted data-[state=checked]:bg-accent data-[state=checked]:font-medium data-[state=checked]:text-foreground data-[state=checked]:before:opacity-100 dark:data-[state=checked]:bg-primary/10',
      },
    },
    defaultVariants: { variant: 'card' },
  },
);

type RadioTileProps = {
  value: string;
  label: string;
  description?: string;
  /** Shown above the name (a row shows it before the name). Give `icon` or `media`. */
  icon?: LucideIcon;
  /** A picture in place of the icon (a card only): a theme preview, say. Decorative. */
  media?: ReactNode;
  /** Rows and tiles show only the name; their description is still announced (aria-describedby). */
  variant?: 'card' | 'tile' | 'row';
  /** Not selectable (arrow keys skip it); say why in `description`. */
  disabled?: boolean;
  className?: string;
};

/**
 * One option of a radio group shown as a card or a list row (Radix radio item: arrow keys move between
 * options, Tab enters at the checked one). The label names it; the description describes it.
 */
export const RadioTile = ({
  value,
  label,
  description,
  icon: Icon,
  media,
  variant,
  disabled,
  className,
}: RadioTileProps) => {
  const id = useId();
  const labelId = `${id}-label`;
  const descriptionId = description ? `${id}-description` : undefined;
  return (
    <RadioGroupPrimitive.Item
      value={value}
      disabled={disabled}
      aria-labelledby={labelId}
      aria-describedby={descriptionId}
      className={cn(tileVariants({ variant }), className)}
    >
      {media ??
        (Icon && variant === 'row' ? (
          <span
            aria-hidden="true"
            className="flex size-4 shrink-0 items-center justify-center text-muted-foreground group-data-[state=checked]/tile:text-primary [&_svg]:size-4"
          >
            <Icon />
          </span>
        ) : Icon ? (
          <IconTile icon={Icon} size="sm" />
        ) : null)}
      <span className={cn('min-w-0', variant !== 'tile' && 'space-y-1')}>
        <span
          id={labelId}
          className={cn(
            'block',
            variant === 'row' && 'truncate',
            variant === 'tile' && 'text-xs leading-tight font-medium',
            (variant === undefined || variant === 'card') && 'text-sm font-semibold',
          )}
        >
          {label}
        </span>
        {description ? (
          <span
            id={descriptionId}
            className={cn(
              'block text-xs leading-snug text-muted-foreground',
              (variant === 'row' || variant === 'tile') && 'sr-only',
            )}
          >
            {description}
          </span>
        ) : null}
      </span>
    </RadioGroupPrimitive.Item>
  );
};
