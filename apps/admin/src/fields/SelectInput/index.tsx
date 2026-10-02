import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ClearButton } from '../ClearButton';
import { choicesOf, fromChoice, isMultiple, toChoice } from '../helpers/choices';
import { inputAria, stringOption } from '../helpers/props';
import { toList } from '../helpers/values';
import type { BuiltInEditorProps } from '../types';

const MultiSelect = (props: BuiltInEditorProps) => {
  const { t } = useTranslation();
  const { value, onChange, readOnly, disabled, field } = props;
  const selected = toList<string>(value);
  const choices = choicesOf(props);
  const summary = choices
    .filter((choice) => selected.includes(choice.value))
    .map((choice) => choice.label)
    .join(', ');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled || readOnly}>
        <Button variant="outline" {...inputAria(props)} className="w-full justify-between font-normal">
          <span className="truncate">
            {summary || stringOption(props, 'placeholder') || t('content.fields.choose')}
          </span>
          <ChevronDown aria-hidden="true" className="opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-(--radix-dropdown-menu-trigger-width)"
        aria-label={field.label}
      >
        {choices.map((choice) => (
          <DropdownMenuCheckboxItem
            key={choice.value}
            checked={selected.includes(choice.value)}
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={(checked) =>
              onChange(
                checked
                  ? choices
                      .map((item) => item.value)
                      .filter((item) => item === choice.value || selected.includes(item))
                  : selected.filter((item) => item !== choice.value),
              )
            }
          >
            {choice.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/** `select`: a dropdown for an enum (a checkbox menu when the enum allows several values). */
export const SelectInput = (props: BuiltInEditorProps) => {
  const { t } = useTranslation();
  const { value, onChange, onBlur, readOnly, disabled, field } = props;
  if (isMultiple(props)) {
    return <MultiSelect {...props} />;
  }
  const current = toChoice(value);
  return (
    <div className="flex items-center gap-1">
      <Select
        value={current}
        disabled={disabled || readOnly}
        onValueChange={(choice) => onChange(fromChoice(props, choice))}
      >
        <SelectTrigger {...inputAria(props)} className="w-full" onBlur={onBlur}>
          <SelectValue placeholder={stringOption(props, 'placeholder') ?? t('content.fields.choose')} />
        </SelectTrigger>
        <SelectContent>
          {choicesOf(props).map((choice) => (
            <SelectItem key={choice.value} value={choice.value}>
              {choice.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {current && !field.required && !readOnly ? (
        <ClearButton label={field.label} disabled={disabled} onClear={() => onChange(null)} />
      ) : null}
    </div>
  );
};
