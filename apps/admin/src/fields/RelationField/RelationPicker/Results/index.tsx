import { Check, Search } from 'lucide-react';
import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { Input } from '@/components/ui/input';
import { cn } from '@/helpers/cn';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { readsContentTargets, type RelationTargetInfo } from '../../../helpers/relationTargetLabel';
import { shortId } from '../../../helpers/titles';
import { useRelationOptions } from '../../../hooks/useRelationOptions';
import { useActiveOption } from '../hooks/useActiveOption';
import { TypeFilter } from '../TypeFilter';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

type ResultsProps = {
  target: RelationTargetInfo;
  /** The relation field's stable ID (interface and any-entry targets are read through it). */
  fieldId: string;
  /** The target's name ("Author", "Featurable", "Any entry"). */
  targetLabel: string;
  /** An entry's own type's label, when worth naming (shown after its title). */
  typeLabelOf: (modelKey: string | undefined) => string | undefined;
  locale: string | null;
  multiple: boolean;
  /** Linked now: shown as selected. */
  selected: readonly string[];
  /** Never offered (the entry being edited, for self-relations). */
  exclude: readonly string[];
  /** No more may be linked (relation `max`): unselected options are disabled. */
  full: boolean;
  onPick: (id: string) => void;
  onUnpick: (id: string) => void;
  className?: string;
  /** Sizing of the scrolling result list (the popover caps it; the sheet lets it grow). */
  listClassName?: string;
};

/**
 * The relation picker's body: a combobox search over the target's titles (when it has a searchable title)
 * and the matching entries as a listbox. A target spanning several types (an interface, any entry) adds a type
 * filter and names each result's type. Focus stays in the search box; ↑/↓ move the highlighted option
 * (`aria-activedescendant`) and Enter picks it. Without a search box the listbox itself takes focus.
 */
export const Results = ({
  target,
  fieldId,
  targetLabel,
  typeLabelOf,
  locale,
  multiple,
  selected,
  exclude,
  full,
  onPick,
  onUnpick,
  className,
  listClassName,
}: ResultsProps) => {
  const { t } = useTranslation();
  const listboxId = useId();
  const [text, setText] = useState('');
  const q = useDebouncedValue(text.trim(), SEARCH_DEBOUNCE_MS);
  const [type, setType] = useState<string | undefined>();
  const list = useRelationOptions({
    target,
    fieldId,
    q,
    types: type ? [type] : [],
    locale,
    pageSize: PAGE_SIZE,
  });
  const searchable = list.searchable;
  const items = list.items.filter((item) => !exclude.includes(item.id));
  const active = useActiveOption(items.map((item) => item.id));
  const optionId = (id: string) => `${listboxId}-${id}`;
  const activeDescendant = active.activeId ? optionId(active.activeId) : undefined;

  useEffect(() => {
    if (activeDescendant) {
      document.getElementById(activeDescendant)?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeDescendant]);

  const choose = (id: string) => {
    const isSelected = selected.includes(id);
    if (multiple && isSelected) {
      onUnpick(id);
    } else if (!(multiple && full)) {
      onPick(id);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      active.move(event.key === 'ArrowDown' ? 1 : -1);
    } else if ((event.key === 'Home' || event.key === 'End') && !searchable) {
      // In the search box Home/End move the caret.
      event.preventDefault();
      if (event.key === 'Home') {
        active.first();
      } else {
        active.last();
      }
    } else if (event.key === 'Enter' && active.activeId) {
      event.preventDefault();
      choose(active.activeId);
    }
  };

  return (
    <div className={cn('flex min-h-0 flex-col gap-3', className)}>
      {searchable ? (
        <div className="relative">
          <Search
            aria-hidden="true"
            className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            role="combobox"
            aria-expanded="true"
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={activeDescendant}
            value={text}
            aria-label={t('content.relation.search', { model: targetLabel })}
            placeholder={t('content.relation.searchPlaceholder')}
            className="pl-9"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
      ) : null}
      {readsContentTargets(target) && list.members.length > 1 ? (
        <TypeFilter members={list.members} value={type} onChange={setType} />
      ) : null}
      <ul
        id={listboxId}
        role="listbox"
        aria-label={t('content.relation.results')}
        aria-multiselectable={multiple || undefined}
        aria-busy={list.isPending || undefined}
        aria-activedescendant={searchable ? undefined : activeDescendant}
        tabIndex={searchable ? undefined : 0}
        onKeyDown={searchable ? undefined : onKeyDown}
        className={cn(
          'min-h-0 space-y-0.5 overflow-y-auto rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
          listClassName,
        )}
      >
        {items.map((item) => {
          const isSelected = selected.includes(item.id);
          const disabled = multiple && full && !isSelected;
          const kind = typeLabelOf(item.model);
          return (
            <li
              key={item.id}
              id={optionId(item.id)}
              role="option"
              aria-selected={isSelected}
              aria-disabled={disabled || undefined}
              data-active={item.id === active.activeId || undefined}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm select-none data-[active]:bg-accent data-[active]:text-accent-foreground',
                disabled && 'cursor-not-allowed opacity-50',
              )}
              // Focus stays in the search box (or on the listbox) while options are clicked.
              onMouseDown={(event) => event.preventDefault()}
              onPointerMove={() => (item.id === active.activeId ? undefined : active.setActiveId(item.id))}
              onClick={() => choose(item.id)}
            >
              <Check aria-hidden="true" className={cn('size-4 shrink-0', !isSelected && 'invisible')} />
              <span className="min-w-0 flex-1 truncate">
                {item.title ?? `${t('content.untitled')} · ${shortId(item.id)}`}
              </span>
              {kind ? <span className="shrink-0 text-meta text-muted-foreground">{kind}</span> : null}
            </li>
          );
        })}
      </ul>
      {list.isPending ? (
        <LoadingState rows={3} />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        <p role="status" className="py-4 text-center text-sm text-muted-foreground">
          {t('content.relation.noResults')}
        </p>
      ) : null}
    </div>
  );
};
