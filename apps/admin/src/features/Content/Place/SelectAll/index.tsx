import { useTranslation } from 'react-i18next';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/helpers/cn';

type SelectAllProps = {
  ids: readonly string[];
  selected: ReadonlySet<string>;
  onSelectChange: (ids: string[], checked: boolean) => void;
  className?: string;
};

/** "Select all entries on this page" above a list without a table header (cards, phone rows). */
export const SelectAll = ({ ids, selected, onSelectChange, className }: SelectAllProps) => {
  const { t } = useTranslation();
  const all = ids.length > 0 && ids.every((id) => selected.has(id));
  const some = ids.some((id) => selected.has(id));
  return (
    <label className={cn('flex w-fit items-center gap-2 text-sm font-medium', className)}>
      <Checkbox
        checked={all ? true : some ? 'indeterminate' : false}
        onCheckedChange={(checked) => onSelectChange([...ids], checked === true)}
      />
      {t('place.list.selectAll')}
    </label>
  );
};
