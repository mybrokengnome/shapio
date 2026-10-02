import { cva } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/helpers/cn';

/**
 * What a state means, not what it's called: draft → neutral, changed → warning, published → success,
 * scheduled → scheduled, failed → danger, running → progress, cancelled/archived → muted.
 */
export type StatusTone = 'neutral' | 'progress' | 'scheduled' | 'success' | 'warning' | 'danger' | 'muted';

const chipVariants = cva(
  'inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full font-semibold whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'bg-muted text-foreground',
        progress: 'bg-muted text-muted-foreground',
        scheduled: 'bg-info-muted text-info',
        success: 'bg-success-muted text-success',
        warning: 'bg-warning-muted text-warning',
        danger: 'bg-destructive-muted text-destructive',
        muted: 'border text-muted-foreground',
      },
      size: {
        default: 'h-6 px-2.5 text-xs',
        sm: 'h-5 px-2 text-2xs',
      },
    },
    defaultVariants: { tone: 'neutral', size: 'default' },
  },
);

const DOT_CLASSES = {
  neutral: 'bg-muted-foreground',
  progress: 'bg-muted-foreground',
  scheduled: 'bg-info',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-destructive',
  muted: 'border border-muted-foreground',
} satisfies Record<StatusTone, string>;

type StatusChipProps = {
  tone: StatusTone;
  /** Always shown: the colour is never the only signal. */
  label: string;
  /** `progress` spins while the work runs; false for states that are over (a timeline's past entries). */
  live?: boolean;
  size?: 'default' | 'sm';
  className?: string;
};

/** A state as a dot + label pill. The one way to show the status of an entry, job, asset, change set… */
export const StatusChip = ({ tone, label, live = true, size, className }: StatusChipProps) => (
  <span data-slot="status-chip" data-tone={tone} className={cn(chipVariants({ tone, size }), className)}>
    {tone === 'progress' && live ? (
      <Loader2 aria-hidden="true" className="size-3 animate-spin motion-reduce:animate-none" />
    ) : (
      <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', DOT_CLASSES[tone])} />
    )}
    {label}
  </span>
);
