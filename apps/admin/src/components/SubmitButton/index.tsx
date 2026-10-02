import { Loader2 } from 'lucide-react';
import type { ComponentProps } from 'react';
import { Button } from '@/components/ui/button';

type SubmitButtonProps = Omit<ComponentProps<typeof Button>, 'type'> & {
  pending: boolean;
  pendingLabel: string;
};

/** A submit button that shows progress and can't be double-submitted. */
export const SubmitButton = ({ pending, pendingLabel, children, disabled, ...props }: SubmitButtonProps) => (
  <Button type="submit" disabled={pending || disabled} aria-busy={pending || undefined} {...props}>
    {pending ? (
      <>
        <Loader2 className="animate-spin" aria-hidden="true" />
        {pendingLabel}
      </>
    ) : (
      children
    )}
  </Button>
);
