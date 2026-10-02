import { cva } from 'class-variance-authority';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/helpers/cn';

const tileVariants = cva('flex shrink-0 items-center justify-center rounded-lg', {
  variants: {
    size: {
      sm: 'size-8 [&_svg]:size-4',
      md: 'size-9 [&_svg]:size-[18px]',
      lg: 'size-10 [&_svg]:size-5',
    },
    tone: {
      // A neutral tile with a cobalt (dark: periwinkle) icon; the accent surface is kept for selection.
      accent: 'bg-muted text-primary dark:text-accent-foreground',
      muted: 'bg-muted text-muted-foreground',
      success: 'bg-success-muted text-success',
      warning: 'bg-warning-muted text-warning',
      danger: 'bg-destructive-muted text-destructive',
    },
  },
  defaultVariants: { size: 'md', tone: 'accent' },
});

type IconTileProps = {
  icon: LucideIcon;
  /** sm 32px, md 36px (default), lg 40px. */
  size?: 'sm' | 'md' | 'lg';
  tone?: 'accent' | 'muted' | 'success' | 'warning' | 'danger';
  className?: string;
};

/** A tinted square holding an icon: cards, pickers, list rows and empty states. Decorative. */
export const IconTile = ({ icon: Icon, size, tone, className }: IconTileProps) => (
  <span aria-hidden="true" className={cn(tileVariants({ size, tone }), className)}>
    <Icon />
  </span>
);
