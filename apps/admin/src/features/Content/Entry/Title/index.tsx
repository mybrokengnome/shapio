import type { FieldDefinition } from '@shapio/schema';
import { useTranslation } from 'react-i18next';
import { FieldMessages } from '@/fields/FieldMessages';
import { useFieldsEnvironment } from '@/fields/form/context';
import { textValue } from '@/fields/helpers/props';
import { useFieldControl } from '@/fields/hooks/useFieldControl';
import { useTopLevelValue } from '@/fields/hooks/useTopLevelValue';
import { cn } from '@/helpers/cn';

type TitleProps = {
  /** The title field when it is edited inline (string/text); otherwise the title is read-only. */
  field: FieldDefinition | undefined;
  /** The entry's heading: its title, "New Article", or "Untitled". */
  heading: string;
};

/**
 * The document's H1. A text title is typed straight into the page (one line that wraps, 44px, no border); the
 * heading itself is for assistive technology and the outline. Any other title type is shown read-only
 * and edited as a property.
 */
export const Title = ({ field, heading }: TitleProps) => {
  if (!field) {
    return <h1 className="text-display break-words">{heading}</h1>;
  }
  return <InlineTitle field={field} heading={heading} />;
};

type InlineTitleProps = { field: FieldDefinition; heading: string };

const InlineTitle = ({ field, heading }: InlineTitleProps) => {
  const { t } = useTranslation();
  const { model, readOnly, disabled } = useFieldsEnvironment();
  const { value, onChange } = useTopLevelValue(field);
  const path = `/${field.apiKey}`;
  const control = useFieldControl({ field, owner: model, value, onChange, path });
  const invalid = control.messages.length > 0;
  return (
    <div className="space-y-1" data-field-path={path} id={`${control.inputId}-section`}>
      <h1 className="sr-only">{heading}</h1>
      <textarea
        id={control.inputId}
        rows={1}
        value={textValue(value)}
        aria-label={field.label}
        aria-describedby={control.builtInProps.describedBy}
        aria-invalid={invalid || undefined}
        aria-required={field.required || undefined}
        readOnly={readOnly}
        disabled={disabled}
        placeholder={t('entry.title.placeholder', { field: field.label })}
        autoComplete="off"
        // One line that wraps on narrow screens: Enter doesn't break it, pasted line breaks become spaces.
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
          }
        }}
        onChange={(event) => {
          const text = event.target.value.replace(/\s*\n\s*/g, ' ');
          onChange(text === '' ? null : text);
        }}
        onBlur={control.builtInProps.onBlur}
        className={cn(
          'field-sizing-content w-full min-w-0 resize-none bg-transparent text-display outline-none placeholder:text-muted-foreground/60',
          '-mx-2 rounded-lg px-2 focus-visible:ring-[3px] focus-visible:ring-ring/50',
          invalid && 'underline decoration-destructive decoration-2 underline-offset-8',
        )}
      />
      <FieldMessages field={field} control={control} />
    </div>
  );
};
