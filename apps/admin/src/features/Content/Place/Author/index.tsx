import type { EntryAuthor } from '@shapio/client';
import { UserAvatar } from '@/components/UserAvatar';
import { cn } from '@/helpers/cn';

type AuthorProps = { author: EntryAuthor | null | undefined; className?: string };

/** Who created the entry: avatar and name (nothing for entries made by tokens, app users or imports). */
export const Author = ({ author, className }: AuthorProps) =>
  author ? (
    <span className={cn('inline-flex min-w-0 items-center gap-2', className)}>
      <UserAvatar name={author.name} size="sm" />
      <span className="truncate">{author.name}</span>
    </span>
  ) : null;
