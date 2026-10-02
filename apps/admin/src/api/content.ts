import type { AdminEntry, ContentListQuery, CreateEntryInput, UpdateEntryInput } from '@shapio/client';
import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { adminApi } from './client';
import { withCsrf } from './csrf';
import { queryKeys } from './queryKeys';

/**
 * Content of any model (`/api/admin/content/:modelKey`). Mutations are silent: the entry form and list
 * show failures themselves (inline issues, the conflict dialog, the "still referenced" explanation).
 */
const silent = { silent: true } as const;

export const entryListQueryOptions = (modelKey: string, query: ContentListQuery) =>
  queryOptions({
    queryKey: queryKeys.content.list(modelKey, query),
    queryFn: () => adminApi.content.list(modelKey, query),
    placeholderData: keepPreviousData,
    meta: silent,
  });

export const useEntryList = (modelKey: string, query: ContentListQuery, enabled = true) =>
  useQuery({ ...entryListQueryOptions(modelKey, query), enabled });

export const entryQueryOptions = (modelKey: string, id: string, locale: string | undefined) =>
  queryOptions({
    queryKey: queryKeys.content.entry(modelKey, id, locale),
    queryFn: () => adminApi.content.get(modelKey, id, locale ? { locale } : {}),
    // The form owns the values once loaded; it is refreshed explicitly (conflicts, restores, locales).
    staleTime: Infinity,
    meta: silent,
  });

export const useEntry = (modelKey: string, id: string, locale: string | undefined, enabled = true) =>
  useQuery({ ...entryQueryOptions(modelKey, id, locale), enabled });

/** Remembers a write's result as the entry's latest state and refreshes that model's lists. */
const rememberEntry = (queryClient: QueryClient, modelKey: string, entry: AdminEntry) => {
  queryClient.setQueryData(queryKeys.content.entry(modelKey, entry.id, entry.locale), entry);
  return queryClient.invalidateQueries({
    predicate: (query) =>
      query.queryKey[0] === 'content' &&
      query.queryKey[1] === modelKey &&
      (query.queryKey[2] === 'list' || query.queryKey[2] === 'revisions'),
  });
};

export const useCreateEntry = (modelKey: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['content', modelKey, 'create'],
    meta: silent,
    mutationFn: (input: CreateEntryInput) => withCsrf(() => adminApi.content.create(modelKey, input)),
    onSuccess: (entry) => rememberEntry(queryClient, modelKey, entry),
  });
};

export const useSaveEntry = (modelKey: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['content', modelKey, 'save'],
    meta: silent,
    mutationFn: ({ id, input }: { id: string; input: UpdateEntryInput }) =>
      withCsrf(() => adminApi.content.update(modelKey, id, input)),
    onSuccess: (entry) => rememberEntry(queryClient, modelKey, entry),
  });
};

/** Omitting `locales` targets the request's default locale; it is the only form a non-localized model accepts. */
type LocalesVariables = { id: string; locales?: string[] };

/** The body never carries an empty `locales` array: the API requires at least one locale when it is sent. */
const localesBody = (locales?: string[]) => (locales && locales.length > 0 ? { locales } : {});

export const usePublishEntry = (modelKey: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['content', modelKey, 'publish'],
    meta: silent,
    mutationFn: ({ id, locales }: LocalesVariables) =>
      withCsrf(() => adminApi.content.publish(modelKey, id, localesBody(locales))),
    onSuccess: (entry) => rememberEntry(queryClient, modelKey, entry),
  });
};

export const useUnpublishEntry = (modelKey: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['content', modelKey, 'unpublish'],
    meta: silent,
    mutationFn: ({ id, locales }: LocalesVariables) =>
      withCsrf(() => adminApi.content.unpublish(modelKey, id, localesBody(locales))),
    onSuccess: (entry) => rememberEntry(queryClient, modelKey, entry),
  });
};

export const useDuplicateEntry = (modelKey: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['content', modelKey, 'duplicate'],
    mutationFn: (id: string) => withCsrf(() => adminApi.content.duplicate(modelKey, id)),
    onSuccess: (entry) => rememberEntry(queryClient, modelKey, entry),
  });
};

/** 409 ENTRY_REFERENCED comes back to the caller, which explains what still points at the entry. */
export const useDeleteEntry = (modelKey: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['content', modelKey, 'delete'],
    meta: silent,
    mutationFn: (id: string) => withCsrf(() => adminApi.content.remove(modelKey, id)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.content.model(modelKey) }),
  });
};

export const useRevisions = (modelKey: string, id: string, locale: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: queryKeys.content.revisions(modelKey, id, locale),
    queryFn: () => adminApi.content.revisions(modelKey, id, locale ? { locale } : {}),
    enabled,
    staleTime: 0,
    meta: silent,
  });

export const useRevision = (modelKey: string, id: string, revisionId: string | undefined) =>
  useQuery({
    queryKey: queryKeys.content.revision(modelKey, id, revisionId ?? ''),
    queryFn: () => adminApi.content.revision(modelKey, id, revisionId ?? ''),
    enabled: revisionId !== undefined,
    staleTime: Infinity,
    meta: silent,
  });

export const useRestoreRevision = (modelKey: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['content', modelKey, 'restore'],
    meta: silent,
    mutationFn: ({
      id,
      revisionId,
      expectedVersion,
    }: {
      id: string;
      revisionId: string;
      expectedVersion: number;
    }) => withCsrf(() => adminApi.content.restore(modelKey, id, revisionId, expectedVersion)),
    onSuccess: (entry) => rememberEntry(queryClient, modelKey, entry),
  });
};
