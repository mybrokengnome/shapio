import type {
  AdminEntry,
  ContentListQuery,
  CreateEntryInput,
  DefinitionListItem,
  UpdateEntryInput,
} from '@shapio/client';
import { ancestorChain, type SchemaDefinition } from '@shapio/schema';
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

/**
 * The model's API key after its ancestors' (root first), from the cached registry: a type's list holds its
 * kinds' entries, so a write to a kind changes every ancestor's list too. Just the key when it is unknown.
 */
export const lineageKeysOf = (queryClient: QueryClient, modelKey: string): string[] => {
  const items = queryClient.getQueryData<DefinitionListItem[]>(queryKeys.schema.definitions('model')) ?? [];
  const byId = new Map<string, SchemaDefinition>(items.map(({ definition }) => [definition.id, definition]));
  const model = items.find(({ definition }) => definition.apiKey === modelKey)?.definition;
  if (!model) {
    return [modelKey];
  }
  const ancestors = ancestorChain(model, (id) => byId.get(id)).ids.flatMap((id) => {
    const apiKey = byId.get(id)?.apiKey;
    return apiKey ? [apiKey] : [];
  });
  return [...ancestors, modelKey];
};

/**
 * Refreshes what a write to these models' entries changes: each model's lists and revisions, and every
 * ancestor's lists. With `counts`, also the entries per model (the sidebar's counts).
 */
export const invalidateEntryLists = (
  queryClient: QueryClient,
  modelKeys: readonly string[],
  { counts = false }: { counts?: boolean } = {},
) => {
  const written = new Set(modelKeys);
  const listed = new Set(modelKeys.flatMap((modelKey) => lineageKeysOf(queryClient, modelKey)));
  return Promise.all([
    queryClient.invalidateQueries({
      predicate: ({ queryKey: [scope, modelKey, part] }) =>
        scope === 'content' &&
        typeof modelKey === 'string' &&
        ((listed.has(modelKey) && part === 'list') || (written.has(modelKey) && part === 'revisions')),
    }),
    counts ? queryClient.invalidateQueries({ queryKey: queryKeys.contentCounts }) : undefined,
  ]);
};

/**
 * Remembers a write's result as the entry's latest state and refreshes its model's lists (the route's and the
 * entry's own, when it was written through a parent type) and their ancestors'.
 */
const rememberEntry = (queryClient: QueryClient, modelKey: string, entry: AdminEntry) => {
  queryClient.setQueryData(queryKeys.content.entry(modelKey, entry.id, entry.locale), entry);
  return invalidateEntryLists(queryClient, [modelKey, entry.model]);
};

/**
 * Which entry a mutation acts on. `modelKey` overrides the hook's: a type's list runs row actions against
 * each row's own kind.
 */
export type EntryTarget = { id: string; modelKey?: string };

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
type LocalesVariables = EntryTarget & { locales?: string[] };

/** The body never carries an empty `locales` array: the API requires at least one locale when it is sent. */
const localesBody = (locales?: string[]) => (locales && locales.length > 0 ? { locales } : {});

/** The draft version(s) the editor saw: the API refuses (409) to publish a draft that moved since. */
type PublishVariables = LocalesVariables & {
  expectedVersion?: number;
  expectedVersions?: Record<string, number>;
};

export const usePublishEntry = (modelKey: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['content', modelKey, 'publish'],
    meta: silent,
    mutationFn: ({ id, locales, modelKey: key = modelKey, ...versions }: PublishVariables) =>
      withCsrf(() => adminApi.content.publish(key, id, { ...localesBody(locales), ...versions })),
    onSuccess: (entry, { modelKey: key = modelKey }) => rememberEntry(queryClient, key, entry),
  });
};

export const useUnpublishEntry = (modelKey: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['content', modelKey, 'unpublish'],
    meta: silent,
    mutationFn: ({ id, locales, modelKey: key = modelKey }: LocalesVariables) =>
      withCsrf(() => adminApi.content.unpublish(key, id, localesBody(locales))),
    onSuccess: (entry, { modelKey: key = modelKey }) => rememberEntry(queryClient, key, entry),
  });
};

export const useDuplicateEntry = (modelKey: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['content', modelKey, 'duplicate'],
    mutationFn: ({ id, modelKey: key = modelKey }: EntryTarget) =>
      withCsrf(() => adminApi.content.duplicate(key, id)),
    onSuccess: (entry, { modelKey: key = modelKey }) => rememberEntry(queryClient, key, entry),
  });
};

/** 409 ENTRY_REFERENCED comes back to the caller, which explains what still points at the entry. */
export const useDeleteEntry = (modelKey: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['content', modelKey, 'delete'],
    meta: silent,
    mutationFn: ({ id, modelKey: key = modelKey }: EntryTarget) =>
      withCsrf(() => adminApi.content.remove(key, id)),
    onSuccess: (_, { modelKey: key = modelKey }) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.content.model(key) }),
        invalidateEntryLists(queryClient, [modelKey, key]),
      ]),
  });
};

/** The entry's revisions (with authors) and publications in a locale, for the history sheet. */
export const useEntryHistory = (modelKey: string, id: string, locale: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: queryKeys.content.revisions(modelKey, id, locale),
    queryFn: () => adminApi.content.history(modelKey, id, locale ? { locale } : {}),
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

/**
 * The kind change an editor asks about: another kind of the entry's family, at the draft version it saw of
 * `locale`'s draft (null: a model that isn't localized).
 */
export type KindChangeVariables = {
  id: string;
  targetModelKey: string;
  expectedVersion: number;
  locale: string | null;
};

/** The change is only sent once the person acknowledged what it drops, so it always acknowledges. */
const kindChangeBody = ({ targetModelKey, expectedVersion, locale }: KindChangeVariables) =>
  ({
    targetModelKey,
    expectedVersion,
    ...(locale ? { locale } : {}),
    acknowledgeDroppedFields: true,
  }) as const;

/** What changing the entry's kind would drop (a dry run); idle until a target is picked. */
export const useKindChangePreview = (modelKey: string, variables: KindChangeVariables | undefined) =>
  useQuery({
    queryKey: queryKeys.content.kindChange(
      modelKey,
      variables?.id ?? '',
      variables?.targetModelKey ?? '',
      variables?.expectedVersion ?? 0,
      variables?.locale ?? null,
    ),
    queryFn: () =>
      variables
        ? withCsrf(() =>
            adminApi.content.previewKindChange(modelKey, variables.id, kindChangeBody(variables)),
          )
        : Promise.reject(new Error('No kind change to preview')),
    enabled: variables !== undefined,
    staleTime: 0,
    retry: false,
    meta: silent,
  });

/**
 * Moves an entry to another kind of its family. The entry is remembered under its new kind; both kinds' lists
 * and their ancestors', and the counts, refresh; the entry under its old kind goes stale without a refetch
 * (the editor leaves it for the new route).
 */
export const useChangeEntryKind = (modelKey: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['content', modelKey, 'changeKind'],
    meta: silent,
    mutationFn: (variables: KindChangeVariables) =>
      withCsrf(() => adminApi.content.changeKind(modelKey, variables.id, kindChangeBody(variables))),
    onSuccess: ({ entry, target }, { id }) => {
      if (entry) {
        queryClient.setQueryData(queryKeys.content.entry(entry.model, entry.id, entry.locale), entry);
      }
      return Promise.all([
        queryClient.invalidateQueries({
          queryKey: [...queryKeys.content.model(modelKey), 'entry', id],
          refetchType: 'none',
        }),
        invalidateEntryLists(queryClient, [modelKey, target.modelKey], { counts: true }),
      ]);
    },
  });
};
