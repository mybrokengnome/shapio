import { Link, type LinkProps } from '@tanstack/react-router';
import { cn } from '@/helpers/cn';

export type LinkTab = { to: LinkProps['to']; label: string };

type LinkTabsProps = { label: string; tabs: readonly LinkTab[]; className?: string };

/**
 * Tabs that are routes: each tab is a link (bookmarkable, back-button friendly), underlined like the
 * `underline` tabs variant (2px primary bar under the current one, which carries `aria-current="page"`).
 */
export const LinkTabs = ({ label, tabs, className }: LinkTabsProps) => (
  <nav aria-label={label} className={cn('w-full border-b', className)}>
    <ul className="-mb-px flex h-10 items-stretch gap-5 overflow-x-auto">
      {tabs.map((tab) => (
        <li key={String(tab.to)} className="flex">
          <Link
            to={tab.to}
            activeOptions={{ exact: true, includeSearch: false }}
            className="relative inline-flex items-center rounded-sm px-0.5 text-sm font-semibold whitespace-nowrap text-muted-foreground transition-colors outline-none after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-[current=page]:text-foreground aria-[current=page]:after:bg-primary"
          >
            {tab.label}
          </Link>
        </li>
      ))}
    </ul>
  </nav>
);
