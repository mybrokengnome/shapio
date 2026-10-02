import type { FieldDefinition, ModelDefinition } from '@shapio/schema';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEntryList } from '@/api/content';
import { LoadingState } from '@/components/LoadingState';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { labelOf, isSearchable } from '@/fields/helpers/titles';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { AddChip } from '../AddChip';
import { RELATION_PICKER_SIZE } from '../constants';

type RelationFilterProps = {
  field: FieldDefinition;
  /** The model the relation points at (undefined when it is gone or not readable). */
  target: ModelDefinition | undefined;
  onPick: (entryId: string) => void;
};

const SEARCH_DEBOUNCE_MS = 250;

/** A dashed "+ Author" chip: pick one entry of the related model to show only entries linked to it. */
export const RelationFilter = ({ field, target, onPick }: RelationFilterProps) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const q = useDebouncedValue(text, SEARCH_DEBOUNCE_MS).trim();
  const searchable = target ? isSearchable(target) : false;
  const options = useEntryList(
    target?.apiKey ?? '',
    { pageSize: RELATION_PICKER_SIZE, ...(searchable && q ? { q } : {}) },
    open && target !== undefined,
  );
  if (!target) {
    return null;
  }
  return (
    <li>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          setText('');
        }}
      >
        <PopoverTrigger asChild>
          <AddChip>{field.label}</AddChip>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 space-y-2 p-2">
          {searchable ? (
            <div className="relative">
              <Search
                aria-hidden="true"
                className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                type="search"
                inputSize="sm"
                value={text}
                className="pl-9"
                aria-label={t('place.filters.findEntry', { model: target.label })}
                placeholder={t('place.filters.findEntry', { model: target.label })}
                onChange={(event) => setText(event.target.value)}
              />
            </div>
          ) : null}
          {options.isPending ? (
            <LoadingState rows={3} className="p-1" />
          ) : options.isError ? (
            <p className="px-2 py-1.5 text-sm text-destructive">{t('place.filters.entriesFailed')}</p>
          ) : options.data.items.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">{t('place.filters.noEntries')}</p>
          ) : (
            <ul aria-label={t('place.filters.entriesOf', { model: target.label })} className="space-y-0.5">
              {options.data.items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="flex h-8 w-full items-center rounded-md px-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    onClick={() => {
                      onPick(item.id);
                      setOpen(false);
                    }}
                  >
                    <span className="truncate">{labelOf(target, item, t('content.untitled'))}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </PopoverContent>
      </Popover>
    </li>
  );
};
