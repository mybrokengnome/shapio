import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { initialsOf } from '@/helpers/initials';

type UserAvatarProps = {
  /** A display name or email; up to two initials are shown. */
  name: string;
  /** sm 24px (dense tables, activity rows), default 32px (user lists). */
  size?: 'sm' | 'default';
  className?: string;
};

/** A person's initials in a circle. Decorative: the name is always shown beside it. */
export const UserAvatar = ({ name, size = 'default', className }: UserAvatarProps) => (
  <Avatar size={size} aria-hidden="true" className={className}>
    <AvatarFallback className="text-xs font-semibold group-data-[size=sm]/avatar:text-2xs">
      {initialsOf(name)}
    </AvatarFallback>
  </Avatar>
);
