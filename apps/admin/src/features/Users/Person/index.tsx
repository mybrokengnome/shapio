import type { ReactNode } from 'react';
import { RowTitle } from '@/components/RowTitle';
import { UserAvatar } from '@/components/UserAvatar';

type PersonProps = { name: string; email: string; badge?: ReactNode };

/** A user list's first cell: avatar, name (with an optional badge) and email. */
export const Person = ({ name, email, badge }: PersonProps) => (
  <span className="flex min-w-0 items-center gap-3">
    <UserAvatar name={name} />
    <span className="min-w-0">
      <span className="flex items-center gap-2">
        <RowTitle className="truncate">{name}</RowTitle>
        {badge}
      </span>
      <span className="block truncate text-meta text-muted-foreground">{email}</span>
    </span>
  </span>
);
