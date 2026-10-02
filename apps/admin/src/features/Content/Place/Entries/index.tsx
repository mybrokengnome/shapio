import type { AdminEntryPage } from '@shapio/client';
import type { ModelDefinition } from '@shapio/schema';
import type { UseQueryResult } from '@tanstack/react-query';
import { FileStack } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { PagePager } from '@/components/PagePager';
import { TableCard } from '@/components/TableCard';
import { liveFields } from '@/fields/helpers/formValues';
import { isSearchable, titleFieldOf } from '@/fields/helpers/titles';
import { useIsMdUp } from '@/fields/hooks/useIsMdUp';
import { CONTENT_PAGE_SIZES } from '../../constants';
import type { ContentSchema } from '../../hooks/useContentSchema';
import { BulkBar } from '../BulkBar';
import { Cards } from '../Cards';
import { EntryTable } from '../EntryTable';
import { FilterChips } from '../FilterChips';
import { quickEditFieldsOf } from '../helpers/quickEditFields';
import { useBulkEntryActions } from '../hooks/useBulkEntryActions';
import { useListColumns } from '../hooks/useListColumns';
import { useListView } from '../hooks/useListView';
import { useModelPresence } from '../hooks/useModelPresence';
import type { usePlacePermissions } from '../hooks/usePlacePermissions';
import type { usePlaceSearch } from '../hooks/usePlaceSearch';
import { usePreviewEntry } from '../hooks/usePreviewEntry';
import { useQuickEditRow } from '../hooks/useQuickEditRow';
import { useRowActions } from '../hooks/useRowActions';
import { useSelection } from '../hooks/useSelection';
import { NewButton } from '../NewButton';
import type { RowContext } from '../Row';
import { Stacked } from '../Stacked';
import { Toolbar } from '../Toolbar';

type EntriesProps = {
  schema: ContentSchema;
  model: ModelDefinition;
  locale: string | null;
  localeLabelOf: (code: string) => string;
  placeSearch: ReturnType<typeof usePlaceSearch>;
  list: UseQueryResult<AdminEntryPage>;
  permissions: ReturnType<typeof usePlacePermissions>;
};

/**
 * A collection's entries: search, filter chips, sort, columns, table or cards, pages, presence, quick
 * actions per row and bulk actions for the selection.
 */
export const Entries = ({
  schema,
  model,
  locale,
  localeLabelOf,
  placeSearch,
  list,
  permissions,
}: EntriesProps) => {
  const { t } = useTranslation();
  const { search, setSearch, sort } = placeSearch;
  const { selected, changeSelection, replaceSelection } = useSelection();
  const bulk = useBulkEntryActions(model.apiKey, locale);
  const { columns, columnChoices, customized, setColumnVisible, resetColumns } = useListColumns(model);
  const { view, cover, setView } = useListView(model);
  const { byEntry: presence } = useModelPresence(model.apiKey);
  const actions = useRowActions(model.apiKey, locale);
  const { preview } = usePreviewEntry(model.apiKey, locale);
  const fields = useMemo(() => liveFields(model.fields), [model]);
  const quickEditRow = useQuickEditRow();
  const wide = useIsMdUp();
  const quickEditable = useMemo(() => quickEditFieldsOf(model).length > 0, [model]);
  const filters = search.filters ?? [];
  const filtered = Boolean(search.q || search.status || search.author || filters.length > 0);
  const title = titleFieldOf(model);
  const context: RowContext = {
    model,
    columns,
    titleColumn: title && columns.includes(title) ? title : undefined,
    locale,
    localeLabelOf,
    permissions,
    actions,
    onPreview: preview,
    quickEdit: permissions.canUpdate && quickEditable ? { schema, ...quickEditRow } : null,
  };
  const setFilters = (next: typeof filters) => setSearch({ filters: next.length > 0 ? next : undefined });
  const setSort = (next: NonNullable<typeof sort>) => setSearch({ sort: `${next.field}:${next.direction}` });
  const pagination = list.data?.pagination;
  const body = () => {
    if (list.isPending) {
      return <LoadingState rows={5} className="p-4" />;
    }
    if (list.isError) {
      return <ErrorState size="panel" error={list.error} onRetry={() => void list.refetch()} />;
    }
    if (list.data.items.length === 0) {
      return (
        <EmptyState
          size="panel"
          icon={FileStack}
          title={filtered ? t('place.list.emptyFiltered') : t('place.list.empty', { place: model.label })}
          action={
            filtered || !permissions.canCreate ? undefined : (
              <NewButton modelKey={model.apiKey} locale={locale} />
            )
          }
        />
      );
    }
    const shared = { context, items: list.data.items, selected, presence, onSelectChange: changeSelection };
    if (view === 'cards' && cover) {
      return <Cards {...shared} cover={cover} />;
    }
    return wide ? <EntryTable {...shared} sort={sort} onSortChange={setSort} /> : <Stacked {...shared} />;
  };
  return (
    <>
      <TableCard
        toolbar={
          <Toolbar
            query={isSearchable(model) ? search.q : null}
            onQueryChange={(q) => setSearch({ q }, { replace: true })}
            fields={fields}
            filters={filters}
            onFiltersChange={setFilters}
            sort={sort}
            onSortChange={setSort}
            columns={
              view === 'table' && wide
                ? {
                    choices: columnChoices,
                    columns,
                    customized,
                    onColumnChange: setColumnVisible,
                    onReset: resetColumns,
                  }
                : null
            }
            view={cover ? { view, onViewChange: setView } : null}
            chips={
              <FilterChips
                schema={schema}
                model={model}
                filters={filters}
                status={search.status}
                author={search.author}
                items={list.data?.items}
                onSearchChange={({ filters: next, ...rest }) =>
                  setSearch({
                    ...rest,
                    ...(next === undefined ? {} : { filters: next.length > 0 ? next : undefined }),
                  })
                }
              />
            }
          />
        }
        footer={
          pagination && pagination.total > 0 ? (
            <PagePager
              page={pagination.page}
              pageSize={pagination.pageSize}
              total={pagination.total}
              pageSizes={CONTENT_PAGE_SIZES}
              onPageChange={(page) => setSearch({ page }, { resetPage: false })}
              onPageSizeChange={(pageSize) => setSearch({ pageSize })}
            />
          ) : undefined
        }
      >
        {body()}
      </TableCard>
      {selected.size > 0 ? (
        <BulkBar
          count={selected.size}
          canPublish={permissions.canPublish}
          canDelete={permissions.canDelete}
          running={bulk.running}
          onClear={() => replaceSelection([])}
          onAction={(action) => void bulk.run(action, [...selected]).then(replaceSelection)}
        />
      ) : null}
    </>
  );
};
