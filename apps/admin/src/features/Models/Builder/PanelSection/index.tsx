import type { ReactNode } from 'react';
import { FieldGroup } from '@/components/ui/field';
import { cn } from '@/helpers/cn';

type PanelSectionProps = {
  title: string;
  /** An ID for the heading, to name a control group by it. */
  titleId?: string;
  className?: string;
  children: ReactNode;
};

/** A titled group of controls inside a builder panel, divided from the one before it. */
export const PanelSection = ({ title, titleId, className, children }: PanelSectionProps) => (
  <section className={cn('space-y-4 border-t pt-5 first:border-t-0 first:pt-0', className)}>
    <h3 id={titleId} className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
      {title}
    </h3>
    <FieldGroup className="gap-5">{children}</FieldGroup>
  </section>
);
