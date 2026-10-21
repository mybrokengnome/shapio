import type {
  AdminEntry,
  ContentListQuery,
  ContentTargetsQuery,
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
import { useState } from 'react';
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

/**
 * The entries a relation to an interface or to any entry may link (`/api/admin/content-targets`, plan
 * interfaces D6): searched across the field's member types, or exactly `ids` (labels for a stored value). Keyed
 * under `contentTargets` so every entry write refreshes it (`invalidateEntryLists`).
 */
const CONTENT_TARGETS_KEY = 'contentTargets';

export const contentTargetsQueryOptions = (query: ContentTargetsQuery) =>
  queryOptions({
    queryKey: [CONTENT_TARGETS_KEY, query] as const,
    queryFn: () => adminApi.content.targets(query),
    placeholderData: keepPreviousData,
    meta: silent,
  });

export const useContentTargets = (query: ContentTargetsQuery, enabled = true) =>
  useQuery({ ...contentTargetsQueryOptions(query), enabled });

/**
 * One entry in one locale (`undefined`: the request's default). Fresh for the default 30 seconds: a form
 * opened on an older copy reads it again first (`useFreshEntry`), so it never starts from a stale one.
 */
export const entryQueryOptions = (modelKey: string, id: string, locale: string | undefined) =>
  queryOptions({
    queryKey: queryKeys.content.entry(modelKey, id, locale),
    queryFn: () => adminApi.content.get(modelKey, id, locale ? { locale } : {}),
    meta: silent,
  });

export const useEntry = (modelKey: string, id: string, locale: string | undefined, enabled = true) =>
  useQuery({ ...entryQueryOptions(modelKey, id, locale), enabled });

/**
 * The entry for a form, which takes its values once, as it opens. A cached copy that is stale at that moment
 * (older than the stale time, or marked stale by a write elsewhere) is not handed out: `data` stays undefined
 * until the read that opening starts comes back. Later reads never take a loaded form away.
 */
export const useFreshEntry = (modelKey: string, id: string, locale: string | undefined) => {
  const query = useEntry(modelKey, id, locale);
  const key = `${modelKey}|${id}|${locale ?? ''}`;
  const staleNow = query.data !== undefined && query.isStale;
  const [opened, setOpened] = useState({ key, stale: staleNow });
  if (opened.key !== key) {
    setOpened({ key, stale: staleNow });
  }
  const waiting = opened.key === key ? opened.stale && !query.isFetchedAfterMount : staleNow;
  return {
    data: waiting ? undefined : query.data,
    error: query.error,
    refetch: query.refetch,
  };
};

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
    // A cross-type picker may list any model's entries.
    queryClient.invalidateQueries({ queryKey: [CONTENT_TARGETS_KEY] }),
    counts ? queryClient.invalidateQueries({ queryKey: queryKeys.contentCounts }) : undefined,
  ]);
};

/**
 * Marks every cached copy of these entries stale (any model key it was read under, any locale, the default
 * locale's `null` key included; their histories too) without reading them again now: a form that opens one
 * next reads it first (`useFreshEntry`). An open form is never refetched under its editor.
 */
export const forgetEntries = (queryClient: QueryClient, entryIds: readonly string[]) => {
  const ids = new Set(entryIds);
  return queryClient.invalidateQueries({
    predicate: ({ queryKey: [scope, , part, id] }) =>
      scope === 'content' &&
      (part === 'entry' || part === 'revisions') &&
      typeof id === 'string' &&
      ids.has(id),
    refetchType: 'none',
  });
};

/**
 * After writes the server made to entries it doesn't name (a change set shipped, an assist run applied):
 * every list refreshes when shown and every cached entry goes stale, with the counts.
 */
export const invalidateAllEntries = (queryClient: QueryClient) =>
  Promise.all([
    queryClient.invalidateQueries({
      predicate: ({ queryKey: [scope, , part] }) => scope === 'content' && part === 'list',
    }),
    queryClient.invalidateQueries({ queryKey: [CONTENT_TARGETS_KEY] }),
    queryClient.invalidateQueries({
      predicate: ({ queryKey: [scope, , part] }) =>
        scope === 'content' && (part === 'entry' || part === 'revisions'),
      refetchType: 'none',
    }),
    queryClient.invalidateQueries({ queryKey: queryKeys.contentCounts }),
  ]);

/**
 * Remembers a write's result as the entry's latest state, under the route's model key and the entry's own
 * kind (they differ when it was written through a parent type), after marking every other cached copy of it
 * stale (another locale key, another route); then refreshes the lists of both models and their ancestors'.
 */
const rememberEntry = (queryClient: QueryClient, modelKey: string, entry: AdminEntry) => {
  void forgetEntries(queryClient, [entry.id]);
  for (const key of new Set([modelKey, entry.model])) {
    queryClient.setQueryData(queryKeys.content.entry(key, entry.id, entry.locale), entry);
  }
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
    onSuccess: (_, { id, modelKey: key = modelKey }) =>
      Promise.all([forgetEntries(queryClient, [id]), invalidateEntryLists(queryClient, [modelKey, key])]),
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
      void forgetEntries(queryClient, [id]);
      if (entry) {
        queryClient.setQueryData(queryKeys.content.entry(entry.model, entry.id, entry.locale), entry);
      }
      return invalidateEntryLists(queryClient, [modelKey, target.modelKey], { counts: true });
    },
  });
};
