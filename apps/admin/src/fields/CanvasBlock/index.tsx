import type { FieldDefinition, SchemaDefinition } from '@shapio/schema';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Label } from '@/components/ui/label';
import { cn } from '@/helpers/cn';
import { FieldEditor } from '../FieldEditor';
import { FieldMessages } from '../FieldMessages';
import { useFieldControl } from '../hooks/useFieldControl';
import { ScopeIcon } from '../ScopeIcon';

type CanvasBlockProps = {
  field: FieldDefinition;
  owner: SchemaDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  path: string;
  /** The model is localized: show whether this field is per locale or shared. */
  showScope: boolean;
};

/**
 * One canvas field of the entry document. Never a form label: a heading (the field's name in small caps
 * and a hairline) always sits above it, so people see where Body ends and Sections begin, two lists of the
 * same component tell apart, and an empty field is still there to fill; it also names the editor for
 * assistive technology. Built-in editors render in `canvas` appearance; a project's custom editor keeps its
 * contract inside a card.
 */
export const CanvasBlock = memo(({ field, owner, value, onChange, path, showScope }: CanvasBlockProps) => {
  const { t } = useTranslation();
  const control = useFieldControl({ field, owner, value, onChange, path, appearance: 'canvas' });
  const custom = control.resolved.kind === 'runtime';
  const LabelElement = control.labelling === 'input' ? Label : 'span';
  return (
    <div
      role="group"
      aria-labelledby={control.labelId}
      id={`${control.inputId}-section`}
      data-field-path={path}
      data-canvas-field={field.type}
      className="relative min-w-0 scroll-mt-24 space-y-2"
    >
      <div
        className="flex items-center gap-2 text-xs font-semibold text-muted-foreground"
        data-canvas-heading
      >
        <LabelElement
          id={control.labelId}
          {...(control.labelling === 'input' ? { htmlFor: control.inputId } : {})}
          className="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
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
        {showScope ? <ScopeIcon localized={field.localized} /> : null}
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
      </div>
      <div className={cn(custom && 'rounded-xl border bg-card p-4')}>
        <FieldEditor control={control} />
      </div>
      <FieldMessages field={field} control={control} />
    </div>
  );
});

CanvasBlock.displayName = 'CanvasBlock';
