import type { FieldDefinition } from '@shapio/schema';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useEntryForm } from '@/fields/form/context';
import { TopLevelField } from '@/fields/form/TopLevelField';
import { countIssuesUnder, issuesByPath } from '@/fields/helpers/issues';
import { useTopLevelValue } from '@/fields/hooks/useTopLevelValue';
import { cn } from '@/helpers/cn';
import { PropertyValue } from '../PropertyValue';

type PropertyRowProps = {
  field: FieldDefinition;
  expanded: boolean;
  onToggle: () => void;
};

/**
 * A property in the settings drawer: one compact line (name, value) that expands to the field's editor on
 * click. A property with problems is always open, so its error is never hidden.
 */
export const PropertyRow = ({ field, expanded, onToggle }: PropertyRowProps) => {
  const { t } = useTranslation();
  const { value } = useTopLevelValue(field);
  const path = `/${field.apiKey}`;
  const problems = useEntryForm((state) => countIssuesUnder(issuesByPath(state.issues), path));
  const open = expanded || problems > 0;
  const bodyId = `entry-property-${field.id}`;
  return (
    <div className="border-b last:border-b-0" data-property-row={field.apiKey}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={onToggle}
        className="flex min-h-10 w-full items-center gap-3 rounded-md px-1 text-left text-sm outline-none hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <ChevronRight
          aria-hidden="true"
          className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')}
        />
        <span className={cn('shrink-0 text-muted-foreground', problems > 0 && 'text-destructive')}>
          {field.label}
          {field.required ? <span className="sr-only"> {t('content.fields.required')}</span> : null}
        </span>
        <span className="ml-auto min-w-0 truncate text-right">
          <PropertyValue field={field} value={value} />
        </span>
      </button>
      {open ? (
        <div id={bodyId} className="px-1 pt-1 pb-4">
          <TopLevelField field={field} layout="bare" />
        </div>
      ) : null}
    </div>
  );
};
