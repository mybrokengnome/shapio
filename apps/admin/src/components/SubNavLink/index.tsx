import { createLink, type LinkComponent } from '@tanstack/react-router';
import { forwardRef, type AnchorHTMLAttributes } from 'react';
import { cn } from '@/helpers/cn';

type AnchorProps = AnchorHTMLAttributes<HTMLAnchorElement>;

const SubNavAnchor = forwardRef<HTMLAnchorElement, AnchorProps>(({ className, ...props }, ref) => (
  <a
    ref={ref}
    className={cn(
      'flex h-9 items-center gap-2.5 rounded-lg px-3 text-sm font-medium whitespace-nowrap text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-[current=page]:bg-accent aria-[current=page]:font-semibold aria-[current=page]:text-accent-foreground [&_svg]:size-4 [&_svg]:shrink-0',
      className,
    )}
    {...props}
  />
));
SubNavAnchor.displayName = 'SubNavAnchor';

const RouterAnchor = createLink(SubNavAnchor);

/** A section link in a `SubNav` (36px row); highlighted while its route is active. */
export const SubNavLink: LinkComponent<typeof SubNavAnchor> = (props) => (
  <RouterAnchor preload="intent" {...props} />
);
