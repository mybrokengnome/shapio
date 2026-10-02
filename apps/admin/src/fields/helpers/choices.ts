import { i18next } from '@/app/i18n';
import type { BuiltInEditorProps } from '../types';
import { stringOption } from './props';

export type Choice = { value: string; label: string };

/** The choices of an enum (labels are content, shown as authored) or a boolean (Yes/No or custom labels). */
export const choicesOf = (props: BuiltInEditorProps): Choice[] => {
  const { definition } = props;
  if (definition.type === 'enum') {
    return definition.settings.values.map(({ value, label }) => ({ value, label }));
  }
  return [
    { value: 'true', label: stringOption(props, 'trueLabel') ?? i18next.t('content.fields.yes') },
    { value: 'false', label: stringOption(props, 'falseLabel') ?? i18next.t('content.fields.no') },
  ];
};

/** Choice value (always a string in the control) → field value. */
export const fromChoice = (props: BuiltInEditorProps, choice: string): unknown => {
  if (choice === '') {
    return null;
  }
  return props.definition.type === 'boolean' ? choice === 'true' : choice;
};

export const toChoice = (value: unknown): string =>
  typeof value === 'boolean' ? String(value) : typeof value === 'string' ? value : '';

export const isMultiple = (props: BuiltInEditorProps) =>
  props.definition.type === 'enum' && props.definition.settings.multiple;
