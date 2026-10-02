import { useNavigate } from '@tanstack/react-router';
import { Loader2, Search } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MIN_SEARCH_LENGTH } from '../constants';
import { useActiveIndex } from '../hooks/useActiveIndex';
import { usePaletteGroups } from '../hooks/usePaletteGroups';
import { useRecentItems } from '../hooks/useRecentItems';
import { Option } from '../Option';
import type { PaletteGroupKey, PaletteItem } from '../types';

const GROUP_LABEL_KEYS = {
  page: 'palette.groups.page',
  recent: 'palette.groups.recent',
  create: 'palette.groups.create',
  goto: 'palette.groups.goto',
  entries: 'palette.groups.entries',
  media: 'palette.groups.media',
} as const satisfies Record<PaletteGroupKey, string>;

type BodyProps = { onClose: () => void };

/**
 * The palette's search field and results: a combobox whose listbox is grouped. Loaded on first open, so the
 * schema helpers it searches with stay out of the first page load.
 */
export const Body = ({ onClose }: BodyProps) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const listboxId = useId();
  const [query, setQuery] = useState('');
  const { recent, remember } = useRecentItems();
  const { groups, isSearching } = usePaletteGroups(query, recent);
  const flat = useMemo(
    () => groups.flatMap((group) => group.items.map((item) => ({ group: group.key, item }))),
    [groups],
  );
  /** Where each group starts in `flat`, so every option knows its position. */
  const offsets = useMemo(
    () =>
      groups.map((_, index) => groups.slice(0, index).reduce((sum, group) => sum + group.items.length, 0)),
    [groups],
  );
  const resetKey = `${query}\u0000${flat.map(({ item }) => item.id).join('|')}`;
  const { activeIndex, setActiveIndex, onKeyDown } = useActiveIndex(flat.length, resetKey);
  const optionId = useCallback((position: number) => `${listboxId}-option-${position}`, [listboxId]);

  useEffect(() => {
    if (activeIndex >= 0) {
      document.getElementById(optionId(activeIndex))?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex, optionId]);

  const select = (group: PaletteGroupKey, item: PaletteItem) => {
    onClose();
    if (item.link) {
      if (group !== 'page' && group !== 'create') {
        const id = item.id.replace(/^recent:/, '');
        remember({
          id,
          label: item.label,
          ...(item.hint ? { hint: item.hint } : {}),
          group,
          link: item.link,
        });
      }
      void navigate(item.link);
    }
    item.run?.();
  };

  const searching = query.trim().length >= MIN_SEARCH_LENGTH && isSearching;
  const status =
    query.trim() === ''
      ? ''
      : searching
        ? t('palette.searching')
        : flat.length === 0
          ? t('palette.noResults', { query: query.trim() })
          : t('palette.resultCount', { count: flat.length });

  return (
    <>
      <div className="flex items-center gap-3 border-b px-4">
        <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <input
          role="combobox"
          aria-expanded="true"
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
          aria-label={t('palette.inputLabel')}
          placeholder={t('palette.placeholder')}
          autoComplete="off"
          // The dialog focuses its content before this lazily loaded field exists.
          autoFocus
          spellCheck={false}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            onKeyDown(event);
            const active = flat[activeIndex];
            if (event.key === 'Enter' && active && !event.nativeEvent.isComposing) {
              event.preventDefault();
              select(active.group, active.item);
            }
          }}
          className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        {searching ? (
          <Loader2 aria-hidden="true" className="size-4 shrink-0 animate-spin text-muted-foreground" />
        ) : null}
      </div>
      <ul
        id={listboxId}
        role="listbox"
        aria-label={t('palette.results')}
        className="max-h-[min(60dvh,26rem)] overflow-y-auto overscroll-contain p-2"
      >
        {groups.map((group, groupIndex) => {
          const labelId = `${listboxId}-${group.key}`;
          return (
            <li key={group.key} role="presentation">
              <ul role="group" aria-labelledby={labelId}>
                <li
                  id={labelId}
                  role="presentation"
                  className="px-2 pt-2 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
                >
                  {t(GROUP_LABEL_KEYS[group.key])}
                </li>
                {group.items.map((item, itemIndex) => {
                  const position = (offsets[groupIndex] ?? 0) + itemIndex;
                  return (
                    <Option
                      key={item.id}
                      id={optionId(position)}
                      item={item}
                      active={position === activeIndex}
                      onHover={() => setActiveIndex(position)}
                      onSelect={() => select(group.key, item)}
                    />
                  );
                })}
              </ul>
            </li>
          );
        })}
        {flat.length === 0 && query.trim() !== '' && !searching ? (
          <li role="presentation" className="px-2 py-8 text-center text-sm text-muted-foreground">
            {t('palette.noResults', { query: query.trim() })}
          </li>
        ) : null}
      </ul>
      <div role="status" className="sr-only">
        {status}
      </div>
      <div className="hidden items-center gap-4 border-t bg-muted/50 px-4 py-2 text-xs text-muted-foreground sm:flex">
        <span>{t('palette.hintMove')}</span>
        <span>{t('palette.hintOpen')}</span>
        <span>{t('palette.hintClose')}</span>
      </div>
    </>
  );
};
