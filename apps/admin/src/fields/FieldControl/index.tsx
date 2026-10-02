import type { FieldDefinition, SchemaDefinition } from '@shapio/schema';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Label } from '@/components/ui/label';
import { cn } from '@/helpers/cn';
import { FieldEditor } from '../FieldEditor';
import { FieldMessages } from '../FieldMessages';
import { useFieldsEnvironment } from '../form/context';
import { useFieldControl } from '../hooks/useFieldControl';
import { ScopeBadge } from '../ScopeBadge';
import { ScopeIcon } from '../ScopeIcon';

export type FieldLayout = 'stacked' | 'inline' | 'bare';

type FieldControlProps = {
  field: FieldDefinition;
  /** The model or component the field belongs to. */
  owner: SchemaDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  /** JSON pointer of the value, e.g. `/hero/title` (issues use the same paths). */
  path: string;
  /** A field of the entry itself (shows the localized/shared badge in localized models). */
  topLevel: boolean;
  /**
   * `stacked` (default): label above the editor (forms, the settings drawer). `inline`: a small label beside
   * the value, a line of a document (the property grid, component blocks in the canvas). `bare`: the
   * label only names the control (the settings drawer's row already shows it).
   */
  layout?: FieldLayout;
  className?: string;
};

/**
 * One field in a form: label (with the localized/shared badge), the editor the field's definition chooses,
 * help text and inline errors.
 */
export const FieldControl = memo(
  ({ field, owner, value, onChange, path, topLevel, layout = 'stacked', className }: FieldControlProps) => {
    const { t } = useTranslation();
    const environment = useFieldsEnvironment();
    const control = useFieldControl({ field, owner, value, onChange, path });
    const LabelElement = control.labelling === 'input' ? Label : 'span';
    const inline = layout === 'inline';
    return (
      <div
        className={cn(
          'min-w-0 scroll-mt-24',
          inline ? 'grid gap-x-4 gap-y-1 sm:grid-cols-[9rem_minmax(0,1fr)]' : 'space-y-2',
          className,
        )}
        id={`${control.inputId}-section`}
        data-field-path={path}
      >
        <div
          className={cn(
            'flex min-h-5 flex-wrap items-center gap-2',
            inline && 'sm:min-h-10 sm:pt-0.5',
            layout === 'bare' && 'sr-only',
          )}
        >
          <LabelElement
            id={control.labelId}
            {...(control.labelling === 'input' ? { htmlFor: control.inputId } : {})}
            className={cn(
              'leading-5',
              inline ? 'text-meta font-medium text-muted-foreground' : 'text-sm font-semibold',
            )}
          >
            {field.label}
            {field.required ? (
              <>
                <span aria-hidden="true" className="ml-0.5 text-destructive">
                  *
                </span>
                <span className="sr-only">{t('content.fields.required')}</span>
              </>
            ) : null}
          </LabelElement>
          {topLevel && environment.model.localized ? (
            inline ? (
              <ScopeIcon localized={field.localized} />
            ) : (
              <ScopeBadge localized={field.localized} />
            )
          ) : null}
        </div>
        <div className="min-w-0 space-y-2">
          <FieldEditor control={control} />
          <FieldMessages field={field} control={control} />
        </div>
      </div>
    );
  },
);

FieldControl.displayName = 'FieldControl';
