import { cva } from 'class-variance-authority';
import type { ReactNode } from 'react';
import { cn } from '@/helpers/cn';

const pageVariants = cva('mx-auto w-full min-w-0 space-y-6', {
  variants: {
    width: {
      /** Tables, grids, editors with side panels. */
      full: '',
      /** Most screens. */
      default: 'max-w-6xl',
      /** Single forms and settings pages. */
      narrow: 'max-w-3xl',
    },
  },
  defaultVariants: { width: 'default' },
});

type PageProps = { width?: 'full' | 'default' | 'narrow'; className?: string; children: ReactNode };

/** A screen's content column: one of three widths, sections 24px apart. The Shell provides the gutter. */
export const Page = ({ width, className, children }: PageProps) => (
  <div data-slot="page" className={cn(pageVariants({ width }), className)}>
    {children}
  </div>
);
