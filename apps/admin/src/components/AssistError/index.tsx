import { cn } from '@/helpers/cn';
import { describeAssistError } from '@/helpers/describeAssistError';

type AssistErrorProps = { error: unknown; id?: string; className?: string };

/** Why an assist failed, inline where it was asked for and announced (the server's message or a translation). */
export const AssistError = ({ error, id, className }: AssistErrorProps) => {
  if (!error) {
    return null;
  }
  return (
    <p id={id} role="alert" className={cn('text-meta text-destructive', className)}>
      {describeAssistError(error)}
    </p>
  );
};
