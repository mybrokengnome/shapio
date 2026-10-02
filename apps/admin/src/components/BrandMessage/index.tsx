import type { ReactNode } from 'react';
import { cn } from '@/helpers/cn';
import { Logo } from '../Logo';

type BrandMessageProps = {
  title: string;
  /** One line. */
  description: string;
  /** The way out: one primary button, optionally a secondary one before it. */
  actions: ReactNode;
  className?: string;
};

/** A whole-screen message on brand (not found, a route that failed): mark, page title, one line, actions. */
export const BrandMessage = ({ title, description, actions, className }: BrandMessageProps) => (
  <div className={cn('flex flex-col items-center justify-center gap-6 px-4 py-16 text-center', className)}>
    <Logo className="size-12" />
    <div className="space-y-2">
      <h1 className="text-title">{title}</h1>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
    <div className="flex flex-wrap items-center justify-center gap-3">{actions}</div>
  </div>
);
