import type { ReactNode } from 'react';
import { cn } from '@/helpers/cn';

type TableCardProps = {
  /** A `ui/table` `Table`. */
  children: ReactNode;
  /** A row under the table: the pager, a summary. */
  footer?: ReactNode;
  /** Above the table, inside the card: a toolbar or bulk-action row. */
  toolbar?: ReactNode;
  className?: string;
};

/** The card surface for a list table (DESIGN.md): border, 12px radius, optional toolbar and footer rows. */
export const TableCard = ({ children, footer, toolbar, className }: TableCardProps) => (
  <div data-slot="table-card" className={cn('min-w-0 overflow-hidden rounded-xl border bg-card', className)}>
    {toolbar ? <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">{toolbar}</div> : null}
    {children}
    {footer ? <div className="border-t px-4 py-2.5">{footer}</div> : null}
  </div>
);
