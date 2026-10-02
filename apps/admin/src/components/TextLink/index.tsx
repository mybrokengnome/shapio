import { createLink, type LinkComponent } from '@tanstack/react-router';
import { forwardRef, type AnchorHTMLAttributes } from 'react';
import { cn } from '@/helpers/cn';

type AnchorProps = AnchorHTMLAttributes<HTMLAnchorElement>;

const StyledAnchor = forwardRef<HTMLAnchorElement, AnchorProps>(({ className, ...props }, ref) => (
  <a
    ref={ref}
    className={cn(
      'rounded-sm font-medium text-link underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50',
      className,
    )}
    {...props}
  />
));
StyledAnchor.displayName = 'StyledAnchor';

const RouterAnchor = createLink(StyledAnchor);

/** An in-app link styled as text (router-aware: typed `to`, preloading, active state). */
export const TextLink: LinkComponent<typeof StyledAnchor> = (props) => (
  <RouterAnchor preload="intent" {...props} />
);
