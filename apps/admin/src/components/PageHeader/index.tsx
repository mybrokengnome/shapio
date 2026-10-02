import { Link, type LinkOptions } from '@tanstack/react-router';
import { Fragment, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/helpers/cn';

export type BreadcrumbItem = {
  label: string;
  /** Where the crumb goes; build it with `linkOptions({ to, params })` for typed params. */
  link?: LinkOptions;
};

type PageHeaderProps = {
  /** The page's h1 (28/700). */
  title: string;
  /** Trail above the title, without the current page (e.g. Content / Articles above "Hello world"). */
  breadcrumb?: readonly BreadcrumbItem[];
  /** Beside the title: a StatusChip, a count. */
  badge?: ReactNode;
  /** One line under the title, 13px muted: "API ID article · version 2", "112 entries". */
  meta?: ReactNode;
  /** Right side: buttons, primary last. */
  actions?: ReactNode;
  /** Under the header, full width: `LinkTabs`, or `TabsList variant="underline"` inside a `Tabs`. */
  tabs?: ReactNode;
  /** Editors: the header (title and actions) stays at the top while the form scrolls. */
  sticky?: boolean;
  className?: string;
};

/** The top of every screen: breadcrumb, title, badge, meta line, actions, tabs. */
export const PageHeader = ({
  title,
  breadcrumb,
  badge,
  meta,
  actions,
  tabs,
  sticky = false,
  className,
}: PageHeaderProps) => {
  const { t } = useTranslation();
  return (
    <header
      data-slot="page-header"
      className={cn(
        'space-y-4',
        sticky &&
          'sticky top-12 z-20 -mx-4 border-b bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:-mx-8 sm:px-8 lg:top-0',
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 space-y-1">
          {breadcrumb && breadcrumb.length > 0 ? (
            <nav aria-label={t('common.breadcrumb')}>
              <ol className="flex flex-wrap items-center gap-1.5 text-meta font-medium text-muted-foreground">
                {breadcrumb.map((crumb, index) => (
                  <Fragment key={`${crumb.label}-${index}`}>
                    {index > 0 ? (
                      <li aria-hidden="true" className="text-muted-foreground/70">
                        /
                      </li>
                    ) : null}
                    <li className="min-w-0 truncate">
                      {crumb.link ? (
                        <Link
                          {...crumb.link}
                          className="rounded-sm outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        >
                          {crumb.label}
                        </Link>
                      ) : (
                        crumb.label
                      )}
                    </li>
                  </Fragment>
                ))}
              </ol>
            </nav>
          ) : null}
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="min-w-0 text-title break-words">{title}</h1>
            {badge}
          </div>
          {meta ? <div className="text-meta text-muted-foreground">{meta}</div> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {tabs}
    </header>
  );
};
