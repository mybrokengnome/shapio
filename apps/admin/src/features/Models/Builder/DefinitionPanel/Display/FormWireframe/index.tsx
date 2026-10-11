import { effectiveFormLayout, type FieldWidth, type ModelDefinition } from '@shapio/schema';
import { useTranslation } from 'react-i18next';
import { cn } from '@/helpers/cn';

type FormWireframeProps = { model: ModelDefinition };

/**
 * The wireframe's spans: the entry form's six-column grid at full size (`@/fields/helpers/widthClasses`)
 * without its container query, since the builder panel is far narrower than the form it pictures.
 */
const SPAN_CLASSES = {
  full: 'col-span-6',
  'two-thirds': 'col-span-4',
  half: 'col-span-3',
  third: 'col-span-2',
} as const satisfies Record<FieldWidth, string>;

/**
 * A wireframe of a form-layout entry (`effectiveFormLayout`): each section's name, then its fields as
 * labelled boxes at their widths, so rows form as widths and field order change. Decorative: screen readers
 * get a one-line summary.
 */
export const FormWireframe = ({ model }: FormWireframeProps) => {
  const { t } = useTranslation();
  const { sections } = effectiveFormLayout(model);
  const count = sections.reduce((total, section) => total + section.fields.length, 0);
  if (count === 0) {
    return null;
  }
  return (
    <div className="rounded-md border bg-muted/40 p-3">
      <p className="sr-only">{t('models.builder.formWireframe', { count })}</p>
      <div aria-hidden="true" className="space-y-3">
        {sections.map((section) => (
          <div key={section.id} className="space-y-1.5">
            {section.label ? (
              <p className="truncate border-b pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {section.label}
              </p>
            ) : null}
            <div className="grid grid-cols-6 gap-1.5">
              {section.fields.map((field) => (
                <div
                  key={field.id}
                  className={cn(
                    'truncate rounded-sm border bg-background px-1.5 py-1 text-xs text-muted-foreground',
                    SPAN_CLASSES[field.width ?? 'full'],
                  )}
                >
                  {field.label || t('models.builder.untitled')}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
