import { useTranslation } from 'react-i18next';
import { HintedLabel } from '@/components/HintedLabel';
import { Field, FieldDescription } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { IssueList } from '../IssueList';
import { controlIds, type ControlBaseProps } from '../types';

/** Radix Select can't hold an empty value; this stands for "not set". */
const UNSET = '__unset__';

type SelectOption = { value: string; label: string };

/** Options under a heading; empty groups are left out. */
export type SelectOptionGroup = { label: string; options: readonly SelectOption[] };

type SelectControlProps = ControlBaseProps & {
  value: string | undefined;
  /** The options, flat; or pass `groups` to show them under headings. */
  options?: readonly SelectOption[];
  groups?: readonly SelectOptionGroup[];
  onChange: (value: string | undefined) => void;
  /** Label of the "not set" choice; when absent, a value must be chosen. */
  unsetLabel?: string;
  placeholder?: string;
};

export const SelectControl = ({
  id,
  label,
  hint,
  description,
  issues = [],
  disabled,
  value,
  options = [],
  groups,
  onChange,
  unsetLabel,
  placeholder,
}: SelectControlProps) => {
  const { t } = useTranslation();
  const ids = controlIds(id, { hint, description, issues });
  const shownGroups = groups?.filter((group) => group.options.length > 0);
  const all = shownGroups ? shownGroups.flatMap((group) => group.options) : options;
  const known = value !== undefined && all.some((option) => option.value === value);
  const item = (option: SelectOption) => (
    <SelectItem key={option.value} value={option.value}>
      {option.label}
    </SelectItem>
  );
  return (
    <Field data-invalid={issues.length > 0 || undefined}>
      <HintedLabel htmlFor={id} label={label} hint={hint} hintId={ids.hintId} />
      <Select
        value={known ? value : unsetLabel ? UNSET : ''}
        onValueChange={(next) => onChange(next === UNSET ? undefined : next)}
        disabled={disabled}
      >
        <SelectTrigger
          id={id}
          className="w-full"
          aria-invalid={issues.length > 0 || undefined}
          aria-describedby={ids.describedBy}
        >
          <SelectValue placeholder={placeholder ?? t('models.choose')} />
        </SelectTrigger>
        <SelectContent>
          {unsetLabel ? <SelectItem value={UNSET}>{unsetLabel}</SelectItem> : null}
          {shownGroups
            ? shownGroups.map((group) => (
                <SelectGroup key={group.label}>
                  <SelectLabel>{group.label}</SelectLabel>
                  {group.options.map(item)}
                </SelectGroup>
              ))
            : options.map(item)}
        </SelectContent>
      </Select>
      {description ? <FieldDescription id={ids.descriptionId}>{description}</FieldDescription> : null}
      <IssueList id={ids.errorId} issues={issues} />
    </Field>
  );
};
