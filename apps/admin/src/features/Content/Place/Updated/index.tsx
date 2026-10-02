import { cn } from '@/helpers/cn';
import { formatDateTime, formatRelativeTime } from '@/helpers/formatDate';

type UpdatedProps = { at: string; className?: string };

/** "2 hr. ago", with the full date and time on hover. */
export const Updated = ({ at, className }: UpdatedProps) => (
  <time dateTime={at} title={formatDateTime(at)} className={cn('text-muted-foreground', className)}>
    {formatRelativeTime(at)}
  </time>
);
