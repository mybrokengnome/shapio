import type { ReactNode } from 'react';
import { cn } from '@/helpers/cn';

export type DetailItem = { label: string; value: ReactNode };

type DetailListProps = { items: readonly DetailItem[]; className?: string };

/** Label / value pairs (a description list), two columns on wide screens. */
export const DetailList = ({ items, className }: DetailListProps) => (
  <dl className={cn('grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2', className)}>
    {items.map((item) => (
      <div key={item.label} className="min-w-0 space-y-0.5">
        <dt className="text-xs font-medium text-muted-foreground">{item.label}</dt>
        <dd className="break-words">{item.value}</dd>
      </div>
    ))}
  </dl>
);
