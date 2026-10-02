import type { BuiltInEditorProps } from '../types';

/** The ARIA wiring every built-in input shares. */
export const inputAria = (
  { inputId, describedBy, validation, readOnly }: BuiltInEditorProps,
  extraDescribedBy?: string,
) => ({
  id: inputId,
  'aria-describedby': [describedBy, extraDescribedBy].filter(Boolean).join(' ') || undefined,
  'aria-invalid': validation.invalid || undefined,
  'aria-readonly': readOnly || undefined,
});

/** An editor option as a string or number (options come from the field definition, so are untyped). */
export const stringOption = (props: BuiltInEditorProps, key: string): string | undefined => {
  const value = props.field.options[key];
  return typeof value === 'string' ? value : undefined;
};

export const numberOption = (props: BuiltInEditorProps, key: string): number | undefined => {
  const value = props.field.options[key];
  return typeof value === 'number' ? value : undefined;
};

export const textValue = (value: unknown): string =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
