import * as React from 'react';
import { cn } from '@/helpers/cn';

type InputProps = React.ComponentProps<'input'> & {
  /** Shapio: `default` (40px) in forms, editors and dialogs; `sm` (36px) in toolbars and filter rows. */
  inputSize?: 'default' | 'sm';
};

function Input({ className, type, inputSize = 'default', ...props }: InputProps) {
  return (
    <input
      type={type}
      data-slot="input"
      data-size={inputSize}
      className={cn(
        'h-10 w-full min-w-0 rounded-lg border border-input bg-card px-3 py-1 text-base text-foreground transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 data-[size=sm]:h-9 md:text-sm dark:bg-input/20',
        'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
        // Shapio: date and time inputs keep the ring while their calendar button (in the shadow DOM) has focus.
        'focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50',
        'aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
