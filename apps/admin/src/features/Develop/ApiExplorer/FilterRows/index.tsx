import { Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { newStableId } from '@/helpers/stableId';
import type { FilterRow } from '../helpers/request';

type FilterRowsProps = { rows: readonly FilterRow[]; onChange: (rows: FilterRow[]) => void };

/** `filters[…]` as key/value rows: `title[$contains]` → `filters[title][$contains]=…`. */
export const FilterRows = ({ rows, onChange }: FilterRowsProps) => {
  const { t } = useTranslation();
  const update = (id: string, patch: Partial<FilterRow>) =>
    onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold">{t('develop.api.request.filters')}</legend>
      {rows.map((row, index) => (
        <div key={row.id} className="flex items-center gap-2">
          <Input
            aria-label={t('develop.api.request.filterKey', { index: index + 1 })}
            placeholder={t('develop.api.request.filterKeyPlaceholder')}
            className="font-mono"
            value={row.key}
            onChange={(event) => update(row.id, { key: event.target.value })}
          />
          <Input
            aria-label={t('develop.api.request.filterValue', { index: index + 1 })}
            placeholder={t('develop.api.request.filterValuePlaceholder')}
            value={row.value}
            onChange={(event) => update(row.id, { value: event.target.value })}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t('develop.api.request.removeFilter', { index: index + 1 })}
            onClick={() => onChange(rows.filter((candidate) => candidate.id !== row.id))}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...rows, { id: newStableId(), key: '', value: '' }])}
      >
        <Plus aria-hidden="true" />
        {t('develop.api.request.addFilter')}
      </Button>
    </fieldset>
  );
};
