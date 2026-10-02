import type { ContentSort } from '@shapio/client';
import type { FieldDefinition } from '@shapio/schema';
import { ArrowDownWideNarrow, ArrowUpNarrowWide, ArrowUpDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { isSortableField, SYSTEM_FILTER_FIELDS } from '../../helpers/filterOperators';
import { SYSTEM_LABEL_KEYS } from '../constants';

type SortMenuProps = {
  fields: readonly FieldDefinition[];
  sort: ContentSort | undefined;
  onSortChange: (sort: ContentSort) => void;
};

/** Sort by any sortable field or a system date, in either direction (the column headers do the same). */
export const SortMenu = ({ fields, sort, onSortChange }: SortMenuProps) => {
  const { t } = useTranslation();
  const choices = [
    ...fields.filter(isSortableField).map((field) => ({ key: field.apiKey, label: field.label })),
    ...SYSTEM_FILTER_FIELDS.map((key) => ({ key, label: t(SYSTEM_LABEL_KEYS[key]) })),
  ];
  const DirectionIcon =
    sort?.direction === 'asc' ? ArrowUpNarrowWide : sort ? ArrowDownWideNarrow : ArrowUpDown;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          <DirectionIcon aria-hidden="true" />
          {t('place.list.sort')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>{t('place.list.sortField')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={sort?.field ?? ''}
          onValueChange={(field) => onSortChange({ field, direction: sort?.direction ?? 'asc' })}
        >
          {choices.map((choice) => (
            <DropdownMenuRadioItem key={choice.key} value={choice.key}>
              {choice.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={sort?.direction ?? ''}
          onValueChange={(direction) =>
            onSortChange({
              field: sort?.field ?? 'updatedAt',
              direction: direction === 'asc' ? 'asc' : 'desc',
            })
          }
        >
          <DropdownMenuRadioItem value="asc">{t('place.list.ascending')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="desc">{t('place.list.descending')}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
