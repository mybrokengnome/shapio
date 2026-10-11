import type { FieldSection } from '@shapio/schema';
import { EntryFields } from '@/fields/form/EntryFields';
import { cn } from '@/helpers/cn';

type SectionProps = {
  section: FieldSection;
  /** An unlabelled section after a group: extra space above, so its fields don't read as part of the group. */
  spaced?: boolean;
};

/**
 * One section of a form-layout entry: a display group's fields under its name in the group-label style and
 * a hairline, or a run of ungrouped fields with no heading (extra space above when it follows a group). Fields
 * span their `width` on the six-column grid.
 */
export const Section = ({ section, spaced = false }: SectionProps) => {
  const headingId = `entry-form-section-${section.id}`;
  return (
    <section
      aria-labelledby={section.label ? headingId : undefined}
      // pt-8: a heading row and its gap, so the rhythm matches a labelled section without a line.
      className={cn('space-y-4', spaced && 'pt-8')}
      data-form-section={section.id}
    >
      {section.label ? (
        <div className="flex items-center gap-2">
          <h2 id={headingId} className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {section.label}
          </h2>
          <span aria-hidden="true" className="h-px flex-1 bg-border" />
        </div>
      ) : null}
      <EntryFields fields={section.fields} mode="widths" />
    </section>
  );
};
