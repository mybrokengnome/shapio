import type { AdminEntryListItem, ContentSort, PresencePerson } from '@shapio/client';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { labelOf } from '@/fields/helpers/titles';
import { isSortableField } from '../../helpers/filterOperators';
import { Row, type RowContext } from '../Row';
import { SortHeader } from './SortHeader';

type EntryTableProps = {
  context: RowContext;
  items: readonly AdminEntryListItem[];
  sort: ContentSort | undefined;
  selected: ReadonlySet<string>;
  presence: ReadonlyMap<string, readonly PresencePerson[]>;
  onSortChange: (sort: ContentSort) => void;
  onSelectChange: (ids: string[], checked: boolean) => void;
};

const NOBODY: readonly PresencePerson[] = [];

/** A place's entries as a table: selectable rows, the chosen field columns, status, locale, last update. */
export const EntryTable = ({
  context,
  items,
  sort,
  selected,
  presence,
  onSortChange,
  onSelectChange,
}: EntryTableProps) => {
  const { t } = useTranslation();
  const { model, columns, titleColumn, locale } = context;
  const allSelected = items.length > 0 && items.every((item) => selected.has(item.id));
  const someSelected = items.some((item) => selected.has(item.id));
  const ariaSort = (field: string) =>
    sort?.field === field ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined;
  const header = (field: string, label: string, sortable: boolean): ReactNode =>
    sortable ? <SortHeader label={label} field={field} sort={sort} onSortChange={onSortChange} /> : label;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10 pl-4">
            <Checkbox
              checked={allSelected ? true : someSelected ? 'indeterminate' : false}
              aria-label={t('place.list.selectAll')}
              onCheckedChange={(checked) =>
                onSelectChange(
                  items.map((item) => item.id),
                  checked === true,
                )
              }
            />
          </TableHead>
          {titleColumn ? null : <TableHead>{t('place.list.entry')}</TableHead>}
          {columns.map((field) => (
            <TableHead key={field.id} aria-sort={ariaSort(field.apiKey)}>
              {header(field.apiKey, field.label, isSortableField(field))}
            </TableHead>
          ))}
          <TableHead>{t('place.list.status')}</TableHead>
          <TableHead>{t('place.list.author')}</TableHead>
          {locale ? <TableHead>{t('place.list.locale')}</TableHead> : null}
          <TableHead aria-sort={ariaSort('updatedAt')}>
            {header('updatedAt', t('place.list.updatedAt'), true)}
          </TableHead>
          <TableHead className="w-0 pr-4">
            <span className="sr-only">{t('common.actions')}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <Row
            key={item.id}
            context={context}
            item={item}
            label={labelOf(model, item, t('content.untitled'))}
            selected={selected.has(item.id)}
            people={presence.get(item.id) ?? NOBODY}
            onSelectChange={(checked) => onSelectChange([item.id], checked)}
          />
        ))}
      </TableBody>
    </Table>
  );
};
