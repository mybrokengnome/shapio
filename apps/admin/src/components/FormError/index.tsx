import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { describeError } from '@/helpers/describeError';

type FormErrorProps = {
  error: unknown;
  /** Replaces the message derived from `error` (for a refusal the form explains better itself). */
  message?: string;
};

/** The server's answer to a failed form submission, shown above the submit button and announced. */
export const FormError = ({ error, message }: FormErrorProps) => {
  if (!error) {
    return null;
  }
  return (
    <Alert variant="destructive">
      <AlertCircle aria-hidden="true" />
      <AlertDescription>{message ?? describeError(error)}</AlertDescription>
    </Alert>
  );
};
