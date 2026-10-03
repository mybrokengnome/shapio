import { Loader2, Sparkles } from 'lucide-react';
import type { ComponentProps } from 'react';
import { Button } from '@/components/ui/button';

type AssistButtonProps = Omit<ComponentProps<typeof Button>, 'type'> & {
  type?: 'button' | 'submit';
  pending: boolean;
  pendingLabel: string;
};

/**
 * Runs an editor assist: the sparkle marks a model-written proposal (the person reviews it before anything
 * is saved), a spinner and `pendingLabel` while the model works, and no double runs.
 */
export const AssistButton = ({
  type = 'button',
  pending,
  pendingLabel,
  children,
  disabled,
  variant = 'ghost',
  size = 'sm',
  ...props
}: AssistButtonProps) => (
  <Button
    type={type}
    variant={variant}
    size={size}
    disabled={pending || disabled}
    aria-busy={pending || undefined}
    {...props}
  >
    {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
    {pending ? pendingLabel : children}
  </Button>
);
