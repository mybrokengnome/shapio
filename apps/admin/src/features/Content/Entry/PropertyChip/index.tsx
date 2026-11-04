import type { FieldDefinition } from '@shapio/schema';
import { CircleAlert } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useEntryForm, useFieldsEnvironment } from '@/fields/form/context';
import { TopLevelField } from '@/fields/form/TopLevelField';
import { countIssuesUnder, issuesByPath } from '@/fields/helpers/issues';
import { useTopLevelValue } from '@/fields/hooks/useTopLevelValue';
import { ScopeIcon } from '@/fields/ScopeIcon';
import { cn } from '@/helpers/cn';
import { PropertyValue } from '../PropertyValue';

type PropertyChipProps = { field: FieldDefinition };

/**
 * One property in the strip under the title: its name and value as a quiet chip. Clicking edits it in
 * place, in a popover anchored to the chip with the field's own editor. Problems mark the chip.
 */
export const PropertyChip = ({ field }: PropertyChipProps) => {
  const { t } = useTranslation();
  const { model } = useFieldsEnvironment();
  const { value } = useTopLevelValue(field);
  const [open, setOpen] = useState(false);
  const path = `/${field.apiKey}`;
  const problems = useEntryForm((state) => countIssuesUnder(issuesByPath(state.issues), path));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        data-property={field.apiKey}
        className={cn(
          '-mx-1.5 inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-meta outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:bg-muted',
          problems > 0 && 'text-destructive',
        )}
      >
        <span className="shrink-0 text-muted-foreground">{field.label}</span>
        <span className="min-w-0 truncate font-medium text-foreground">
          <PropertyValue field={field} value={value} />
        </span>
        {model.localized ? <ScopeIcon localized={field.localized} /> : null}
        {problems > 0 ? (
          <CircleAlert
            aria-label={t('content.items.problems', { count: problems })}
            className="size-3.5 shrink-0"
          />
        ) : null}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(24rem,calc(100vw-2rem))]">
        <TopLevelField field={field} />
      </PopoverContent>
    </Popover>
  );
};
