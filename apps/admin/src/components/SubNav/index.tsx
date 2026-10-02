import { Children, type ReactNode } from 'react';
import { cn } from '@/helpers/cn';

type SubNavProps = {
  /** The navigation's accessible name, e.g. "Settings sections". */
  label: string;
  className?: string;
  /** `SubNavGroup`s. */
  children: ReactNode;
};

/**
 * A feature's section navigation: a 224px card column on wide screens, a horizontal scroller on narrow
 * ones. Holds `SubNavGroup`s of `SubNavLink`s.
 */
export const SubNav = ({ label, className, children }: SubNavProps) => (
  <nav
    aria-label={label}
    className={cn(
      'min-w-0 lg:w-56 lg:shrink-0 lg:self-start lg:rounded-xl lg:border lg:bg-card lg:p-2',
      className,
    )}
  >
    <div className="flex gap-4 overflow-x-auto pb-2 lg:flex-col lg:gap-3 lg:overflow-visible lg:pb-0">
      {children}
    </div>
  </nav>
);

type SubNavGroupProps = {
  /** 12px uppercase group label; omit for a single unlabelled group. */
  label?: string;
  /** `SubNavLink`s (each is wrapped in a list item). */
  children: ReactNode;
};

export const SubNavGroup = ({ label, children }: SubNavGroupProps) => (
  <div className="flex shrink-0 flex-col gap-1">
    {label ? (
      <h2 className="px-3 pt-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {label}
      </h2>
    ) : null}
    <ul className="flex gap-1 lg:flex-col">
      {Children.map(children, (child) => (child ? <li className="shrink-0">{child}</li> : null))}
    </ul>
  </div>
);
