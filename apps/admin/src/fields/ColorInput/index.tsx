import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { cn } from '@/helpers/cn';
import { inputAria, textValue } from '../helpers/props';
import type { BuiltInEditorProps } from '../types';

const HEX_COLOUR = /^#[0-9a-f]{6}$/i;
/** The native picker needs some value when the field is empty or not hex; black, built so no hex literal appears. */
const EMPTY_PICKER_VALUE = `#${'0'.repeat(6)}`;

const presetsOf = (props: BuiltInEditorProps): string[] => {
  const presets = props.field.options.presets;
  return Array.isArray(presets)
    ? presets.filter((preset): preset is string => typeof preset === 'string')
    : [];
};

/** A swatch shows a user-chosen colour: the one dynamic value, passed through a CSS variable. */
const swatchStyle = (colour: string) => ({ '--swatch': colour }) as CSSProperties;

/** `color`: a colour stored as text (hex or `rgb(…)`), with a picker and the field's preset swatches. */
export const ColorInput = (props: BuiltInEditorProps) => {
  const { t } = useTranslation();
  const { value, onChange, onBlur, readOnly, disabled, field } = props;
  const text = textValue(value);
  const presets = presetsOf(props);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={t('content.fields.color.picker', { field: field.label })}
          value={HEX_COLOUR.test(text) ? text.toLowerCase() : EMPTY_PICKER_VALUE}
          disabled={disabled || readOnly}
          className="size-10 shrink-0 cursor-pointer rounded-lg border border-input bg-transparent p-1 disabled:cursor-not-allowed"
          onChange={(event) => onChange(event.target.value)}
        />
        <Input
          {...inputAria(props)}
          value={text}
          spellCheck={false}
          readOnly={readOnly}
          disabled={disabled}
          className="max-w-48 font-mono text-sm"
          onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
          onBlur={onBlur}
        />
      </div>
      {presets.length > 0 ? (
        <div role="group" aria-label={t('content.fields.color.presets')} className="flex flex-wrap gap-1.5">
          {presets.map((preset) => (
            <button
              key={preset}
              type="button"
              aria-label={preset}
              aria-pressed={preset.toLowerCase() === text.toLowerCase()}
              disabled={disabled || readOnly}
              style={swatchStyle(preset)}
              className={cn(
                'size-7 rounded-md border border-input bg-(--swatch) outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                preset.toLowerCase() === text.toLowerCase() &&
                  'ring-2 ring-ring ring-offset-2 ring-offset-background',
              )}
              onClick={() => onChange(preset)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
};
