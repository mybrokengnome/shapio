import { useTranslation } from 'react-i18next';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type StatusFilterProps<TStatus extends string> = {
  id: string;
  label: string;
  value: TStatus | undefined;
  options: readonly { value: TStatus; label: string }[];
  onChange: (value: TStatus | undefined) => void;
  allLabel?: string;
};

const ALL = '__all';

/** A compact "Status: All" select for a table's toolbar; the label is part of the control and its name. */
export const StatusFilter = <TStatus extends string>({
  id,
  label,
  value,
  options,
  onChange,
  allLabel,
}: StatusFilterProps<TStatus>) => {
  const { t } = useTranslation();
  const labelId = `${id}-label`;
  return (
    <Select
      value={value ?? ALL}
      onValueChange={(next) => onChange(options.find((option) => option.value === next)?.value)}
    >
      <SelectTrigger id={id} size="sm" aria-labelledby={labelId} className="min-w-40">
        <span className="flex min-w-0 items-center gap-1.5">
          <span id={labelId} className="text-muted-foreground">
            {label}
          </span>
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel ?? t('publishing.filters.all')}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};
