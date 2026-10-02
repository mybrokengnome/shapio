import { cva } from 'class-variance-authority';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/helpers/cn';
import { IconTile } from '../IconTile';

const emptyVariants = cva('flex flex-col items-center justify-center gap-3 px-6 text-center', {
  variants: {
    size: {
      /** Inside a Panel or a card: no surface of its own. */
      panel: 'py-10',
      /** The whole screen's content: on a card surface. */
      page: 'rounded-xl border bg-card py-16',
    },
  },
  defaultVariants: { size: 'page' },
});

type EmptyStateProps = {
  title: string;
  /** One line. */
  description?: string;
  icon?: LucideIcon;
  /** One primary action. */
  action?: ReactNode;
  size?: 'panel' | 'page';
  /**
   * One row (about 56px) instead of a centred block: a small icon tile, the title and the description
   * inline. For panels that sit beside others and must stay as short as their content. Ignores `size`.
   */
  compact?: boolean;
  className?: string;
};

export const EmptyState = ({
  title,
  description,
  icon,
  action,
  size,
  compact,
  className,
}: EmptyStateProps) =>
  compact ? (
    <div className={cn('flex items-center gap-3 px-5 py-3 text-left', className)}>
      {icon ? <IconTile icon={icon} size="sm" /> : null}
      <p className="min-w-0 flex-1 text-sm">
        <span className="font-semibold">{title}</span>
        {description ? <span className="text-muted-foreground"> {description}</span> : null}
      </p>
      {action}
    </div>
  ) : (
    <div className={cn(emptyVariants({ size }), className)}>
      {icon ? <IconTile icon={icon} size="lg" /> : null}
      <div className="space-y-1">
        <p className="text-base font-semibold">{title}</p>
        {description ? <p className="max-w-md text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  );
