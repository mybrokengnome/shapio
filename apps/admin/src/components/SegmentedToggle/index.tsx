import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/helpers/cn';

export type SegmentedToggleOption<TValue extends string> = {
  value: TValue;
  label: string;
  icon?: LucideIcon;
};

type SegmentedToggleProps<TValue extends string> = {
  value: TValue;
  options: readonly SegmentedToggleOption<TValue>[];
  onChange: (value: TValue) => void;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  /** Icons only, each label as its button's accessible name (the options must have icons). */
  iconOnly?: boolean;
  disabled?: boolean;
  className?: string;
};

/**
 * A switch between a few options as one rounded pill: the chosen option is a `secondary` button, the others
 * `ghost`, each with `aria-pressed`. Pressing the chosen option does nothing. 36px tall, like an `sm` control
 * row. Used for the place's table/cards view.
 */
export const SegmentedToggle = <TValue extends string>({
  value,
  options,
  onChange,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  iconOnly = false,
  disabled = false,
  className,
}: SegmentedToggleProps<TValue>) => (
  <div
    role="group"
    aria-label={ariaLabel}
    aria-labelledby={ariaLabelledBy}
    className={cn('flex h-9 w-fit items-center gap-0.5 rounded-lg border border-input px-px', className)}
  >
    {options.map(({ value: option, label, icon: Icon }) => {
      const pressed = option === value;
      return (
        <Button
          key={option}
          type="button"
          variant={pressed ? 'secondary' : 'ghost'}
          size={iconOnly ? 'icon-sm' : 'sm'}
          aria-pressed={pressed}
          aria-label={iconOnly ? label : undefined}
          disabled={disabled}
          onClick={pressed ? undefined : () => onChange(option)}
        >
          {Icon ? <Icon aria-hidden="true" /> : null}
          {iconOnly ? null : label}
        </Button>
      );
    })}
  </div>
);
