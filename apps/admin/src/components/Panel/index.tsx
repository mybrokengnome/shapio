import { useId, type ReactNode } from 'react';
import { cn } from '@/helpers/cn';

type PanelProps = {
  /** Header title (16/600). With a title the panel is a labelled region. */
  title?: string;
  /** Heading level of the title in the page outline. */
  titleAs?: 'h2' | 'h3';
  /** One line under the title, or nothing (DESIGN.md, helper-text rule). */
  description?: string;
  /** Right side of the header row: buttons (size sm), a count, a menu. */
  actions?: ReactNode;
  /**
   * The body touches the panel edges (tables, lists, rails); the header then gets a bottom border.
   * Otherwise the body has the panel padding.
   */
  flush?: boolean;
  /** Accessible name when there is no visible title. */
  'aria-label'?: string;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
};

/** A card surface with an optional header row: side panels, settings groups, dashboard blocks. */
export const Panel = ({
  title,
  titleAs: Heading = 'h2',
  description,
  actions,
  flush = false,
  'aria-label': ariaLabel,
  className,
  bodyClassName,
  children,
}: PanelProps) => {
  const titleId = useId();
  const hasHeader = Boolean(title || actions);
  return (
    <section
      data-slot="panel"
      aria-labelledby={title ? titleId : undefined}
      aria-label={title ? undefined : ariaLabel}
      className={cn('min-w-0 rounded-xl border bg-card text-card-foreground', className)}
    >
      {hasHeader ? (
        <div
          data-slot="panel-header"
          className={cn('flex items-start justify-between gap-3 px-5 pt-4', flush ? 'border-b pb-4' : 'pb-3')}
        >
          <div className="min-w-0 space-y-0.5">
            {title ? (
              <Heading id={titleId} className="text-base leading-6 font-semibold">
                {title}
              </Heading>
            ) : null}
            {description ? <p className="text-meta text-muted-foreground">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div data-slot="panel-body" className={cn(!flush && (hasHeader ? 'px-5 pb-5' : 'p-5'), bodyClassName)}>
        {children}
      </div>
    </section>
  );
};
