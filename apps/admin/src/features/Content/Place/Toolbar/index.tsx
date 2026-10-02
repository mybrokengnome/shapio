import type { ContentSort } from '@shapio/client';
import type { FieldDefinition } from '@shapio/schema';
import { Search } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { useSearchInput } from '@/hooks/useSearchInput';
import type { ListFilter } from '../../helpers/filterOperators';
import { ColumnsMenu } from '../ColumnsMenu';
import type { ListView } from '../constants';
import { FilterBuilder } from '../FilterBuilder';
import { SortMenu } from '../SortMenu';
import { ViewToggle } from '../ViewToggle';

type ToolbarProps = {
  /** Null when the model has no text title field to search. */
  query: string | undefined | null;
  onQueryChange: (query: string | undefined) => void;
  fields: readonly FieldDefinition[];
  filters: readonly ListFilter[];
  onFiltersChange: (filters: ListFilter[]) => void;
  sort: ContentSort | undefined;
  onSortChange: (sort: ContentSort) => void;
  /** The column chooser (table view only). */
  columns: ComponentProps<typeof ColumnsMenu> | null;
  /** The table/cards switch (models with a cover only). */
  view: { view: ListView; onViewChange: (view: ListView) => void } | null;
  /** The filter chips row, full width under the controls. */
  chips: ReactNode;
};

/** Search by title (grows), then filters, sort, columns and the view switch; the filter chips below. */
export const Toolbar = ({
  query,
  onQueryChange,
  fields,
  filters,
  onFiltersChange,
  sort,
  onSortChange,
  columns,
  view,
  chips,
}: ToolbarProps) => {
  const { t } = useTranslation();
  const { text, setText } = useSearchInput(query ?? undefined, onQueryChange);
  return (
    <>
      {query !== null ? (
        <div className="relative min-w-48 flex-1">
          <Search
            aria-hidden="true"
            className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            inputSize="sm"
            value={text}
            aria-label={t('place.list.search')}
            placeholder={t('place.list.searchPlaceholder')}
            className="pl-9"
            onChange={(event) => setText(event.target.value)}
          />
        </div>
      ) : (
        <div className="flex-1" />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <FilterBuilder fields={fields} filters={filters} onChange={onFiltersChange} />
        <SortMenu fields={fields} sort={sort} onSortChange={onSortChange} />
        {columns ? <ColumnsMenu {...columns} /> : null}
        {view ? <ViewToggle {...view} /> : null}
      </div>
      {chips}
    </>
  );
};
