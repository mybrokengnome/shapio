import type { ContentListQuery, ContentSort } from '@shapio/client';
import type { ModelDefinition } from '@shapio/schema';
import { useNavigate, useSearch } from '@tanstack/react-router';
import type { ContentListSearch } from '@/app/searchSchemas';
import { DEFAULT_CONTENT_PAGE_SIZE } from '../../constants';
import { toContentFilter } from '../../helpers/filterOperators';

const parseSort = (sort: string | undefined): ContentSort | undefined => {
  const [field, direction] = sort?.split(':') ?? [];
  return field && (direction === 'asc' || direction === 'desc') ? { field, direction } : undefined;
};

/** The model's configured default sort, as the API's sort (by API key). */
const defaultSortOf = (model: ModelDefinition): ContentSort | undefined => {
  const configured = model.display.defaultSort;
  const field = configured
    ? model.fields.find((candidate) => candidate.id === configured.fieldId)
    : undefined;
  return field && configured ? { field: field.apiKey, direction: configured.direction } : undefined;
};

export type SetPlaceSearch = (
  changes: Partial<ContentListSearch>,
  options?: { resetPage?: boolean; replace?: boolean },
) => void;

/** The list's search, filters, sort, page and locale live in the URL (bookmarkable, back-button friendly). */
export const usePlaceSearch = (model: ModelDefinition, locale: string | null) => {
  const search = useSearch({ from: '/app/content/$modelKey' });
  const navigate = useNavigate({ from: '/content/$modelKey' });
  const setSearch: SetPlaceSearch = (changes, { resetPage = true, replace = false } = {}) =>
    void navigate({
      search: (previous) => ({ ...previous, ...(resetPage ? { page: undefined } : {}), ...changes }),
      replace,
    });
  const sort = parseSort(search.sort) ?? defaultSortOf(model);
  const filter = toContentFilter(search.filters ?? []);
  const query: ContentListQuery = {
    page: search.page ?? 1,
    pageSize: search.pageSize ?? DEFAULT_CONTENT_PAGE_SIZE,
    ...(search.q ? { q: search.q } : {}),
    ...(sort ? { sort: [sort] } : {}),
    ...(filter ? { filters: filter } : {}),
    ...(locale ? { locale } : {}),
    ...(search.status ? { status: search.status } : {}),
    ...(search.author ? { author: search.author } : {}),
  };
  return { search, setSearch, query, sort };
};
