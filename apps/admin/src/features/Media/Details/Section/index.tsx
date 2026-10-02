import type { ReactNode } from 'react';

type SectionProps = { title: string; children: ReactNode };

/** A titled block of the details sheet. */
export const Section = ({ title, children }: SectionProps) => (
  <section className="space-y-3">
    <h3 className="text-sm font-semibold">{title}</h3>
    {children}
  </section>
);
