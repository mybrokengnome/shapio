import type { FieldDefinition } from '@shapio/schema';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadingState } from '@/components/LoadingState';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { relationTargetLabel, type RelationTargetInfo } from '@/fields/helpers/relationTargetLabel';
import { shortId } from '@/fields/helpers/titles';
import { useRelationOptions } from '@/fields/hooks/useRelationOptions';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { AddChip } from '../AddChip';
import { RELATION_PICKER_SIZE } from '../constants';

type RelationFilterProps = {
  field: FieldDefinition;
  /** What the relation points at: a model, an interface, any entry, or a type this role can't read. */
  target: RelationTargetInfo;
  onPick: (entryId: string) => void;
};

const SEARCH_DEBOUNCE_MS = 250;

/**
 * A dashed "+ Author" chip: pick one entry of the related model (or of any type an interface or any-entry
 * relation accepts) to show only entries linked to it.
 */
export const RelationFilter = ({ field, target, onPick }: RelationFilterProps) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const q = useDebouncedValue(text, SEARCH_DEBOUNCE_MS).trim();
  const label = relationTargetLabel(target, t);
  const options = useRelationOptions({
    target,
    fieldId: field.id,
    q,
    types: [],
    locale: null,
    pageSize: RELATION_PICKER_SIZE,
    enabled: open && label !== undefined,
  });
  if (label === undefined) {
    return null;
  }
  const searchable = options.searchable;
  // Across types (an interface, any entry), each entry names its type.
  const typeLabels = new Map(options.members.map((member) => [member.apiKey, member.label]));
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
                aria-label={t('place.filters.findEntry', { model: label })}
                placeholder={t('place.filters.findEntry', { model: label })}
                onChange={(event) => setText(event.target.value)}
              />
            </div>
          ) : null}
          {options.isPending ? (
            <LoadingState rows={3} className="p-1" />
          ) : options.isError ? (
            <p className="px-2 py-1.5 text-sm text-destructive">{t('place.filters.entriesFailed')}</p>
          ) : options.items.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">{t('place.filters.noEntries')}</p>
          ) : (
            <ul aria-label={t('place.filters.entriesOf', { model: label })} className="space-y-0.5">
              {options.items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    onClick={() => {
                      onPick(item.id);
                      setOpen(false);
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {item.title ?? `${t('content.untitled')} · ${shortId(item.id)}`}
                    </span>
                    {typeLabels.has(item.model) ? (
                      <span className="shrink-0 text-meta text-muted-foreground">
                        {typeLabels.get(item.model)}
                      </span>
                    ) : null}
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
