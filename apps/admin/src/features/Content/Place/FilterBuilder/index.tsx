import type { ContentFilterOperator } from '@shapio/client';
import type { FieldDefinition } from '@shapio/schema';
import { Filter, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  isValueless,
  OPERATOR_LABEL_KEYS,
  operatorsFor,
  SYSTEM_FILTER_FIELDS,
  type ListFilter,
} from '../../helpers/filterOperators';
import { SYSTEM_LABEL_KEYS } from '../constants';

type FilterBuilderProps = {
  fields: readonly FieldDefinition[];
  filters: readonly ListFilter[];
  onChange: (filters: ListFilter[]) => void;
};

const isSystemField = (key: string): key is (typeof SYSTEM_FILTER_FIELDS)[number] =>
  (SYSTEM_FILTER_FIELDS as readonly string[]).includes(key);

/**
 * Filter rows (field, operator, value) using the operators the content API allows for each field. Edits
 * apply when the person presses Apply, so typing doesn't reload the list on every key.
 */
export const FilterBuilder = ({ fields, filters, onChange }: FilterBuilderProps) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ListFilter[]>([...filters]);
  const filterable = fields.filter((field) => operatorsFor(field).length > 0);
  const choices = [
    ...filterable.map((field) => ({ key: field.apiKey, label: field.label, operators: operatorsFor(field) })),
    ...SYSTEM_FILTER_FIELDS.map((key) => ({
      key,
      label: t(SYSTEM_LABEL_KEYS[key]),
      operators: operatorsFor(key),
    })),
  ];
  const operatorsOf = (key: string) => choices.find((choice) => choice.key === key)?.operators ?? [];
  const update = (index: number, change: Partial<ListFilter>) =>
    setDraft((current) => current.map((row, at) => (at === index ? { ...row, ...change } : row)));
  const first = choices[0];
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setDraft([...filters]);
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline">
          <Filter aria-hidden="true" />
          {t('place.filters.button')}
          {filters.length > 0 ? <Badge variant="secondary">{filters.length}</Badge> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(36rem,calc(100vw-2rem))] space-y-3">
        <p className="text-sm font-semibold">{t('place.filters.title')}</p>
        {draft.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('place.filters.none')}</p>
        ) : null}
        <ul className="space-y-2">
          {draft.map((row, index) => {
            const operators = operatorsOf(row.field);
            const fieldLabel = choices.find((choice) => choice.key === row.field)?.label ?? row.field;
            return (
              <li key={index} className="flex flex-wrap items-center gap-2">
                <Select
                  value={row.field}
                  onValueChange={(field) =>
                    update(index, { field, operator: operatorsOf(field)[0] ?? '$eq', value: '' })
                  }
                >
                  <SelectTrigger
                    size="sm"
                    className="w-40"
                    aria-label={t('place.filters.field', { index: index + 1 })}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {choices.map((choice) => (
                      <SelectItem key={choice.key} value={choice.key}>
                        {choice.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={row.operator}
                  onValueChange={(operator) => update(index, { operator: operator as ContentFilterOperator })}
                >
                  <SelectTrigger
                    size="sm"
                    className="w-40"
                    aria-label={t('place.filters.operator', { field: fieldLabel })}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {operators.map((operator) => (
                      <SelectItem key={operator} value={operator}>
                        {t(OPERATOR_LABEL_KEYS[operator])}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {isValueless(row.operator) ? null : (
                  <Input
                    value={row.value ?? ''}
                    inputSize="sm"
                    className="min-w-32 flex-1"
                    type={isSystemField(row.field) ? 'datetime-local' : 'text'}
                    aria-label={t('place.filters.value', { field: fieldLabel })}
                    placeholder={
                      row.operator === '$in' || row.operator === '$nin'
                        ? t('place.filters.listPlaceholder')
                        : undefined
                    }
                    onChange={(event) => update(index, { value: event.target.value })}
                  />
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('place.filters.remove', { field: fieldLabel })}
                  onClick={() => setDraft((current) => current.filter((_, at) => at !== index))}
                >
                  <X aria-hidden="true" />
                </Button>
              </li>
            );
          })}
        </ul>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!first}
            onClick={() =>
              first &&
              setDraft((current) => [
                ...current,
                { field: first.key, operator: first.operators[0] ?? '$eq', value: '' },
              ])
            }
          >
            <Plus aria-hidden="true" />
            {t('place.filters.add')}
          </Button>
          <div className="flex gap-2">
            {filters.length > 0 ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  onChange([]);
                  setOpen(false);
                }}
              >
                {t('place.filters.clear')}
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              onClick={() => {
                onChange(draft.filter((row) => isValueless(row.operator) || (row.value ?? '').trim() !== ''));
                setOpen(false);
              }}
            >
              {t('place.filters.apply')}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};
