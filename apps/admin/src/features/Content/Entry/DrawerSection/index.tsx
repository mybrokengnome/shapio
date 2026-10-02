import type { ReactNode } from 'react';

type DrawerSectionProps = { id: string; title: string; children: ReactNode };

/** A section of the settings drawer: a 12px uppercase heading and compact rows. */
export const DrawerSection = ({ id, title, children }: DrawerSectionProps) => (
  <section aria-labelledby={id} className="scroll-mt-4 space-y-2" data-drawer-section={id}>
    <h3 id={id} className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
      {title}
    </h3>
    {children}
  </section>
);
