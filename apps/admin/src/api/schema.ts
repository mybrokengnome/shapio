import type {
  CreateDefinitionInput,
  DefinitionCategory,
  DefinitionListItem,
  DefinitionPayload,
} from '@shapio/client';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import {
  FINAL_CHANGE_STATUSES,
  SCHEMA_CHANGE_POLL_INTERVAL_MS,
  SCHEMA_POLL_INTERVAL_MS,
  SCHEMA_VERSION_STALE_MS,
} from '@/constants/schema';
import { adminApi } from './client';
import { withCsrf } from './csrf';
import { queryKeys } from './queryKeys';

const silent = { silent: true } as const;

const definitionApi = (category: DefinitionCategory) =>
  category === 'model' ? adminApi.models : adminApi.components;

/** Every active model or component (the registry), also read by route guards. */
export const definitionsQueryOptions = (category: DefinitionCategory) =>
  queryOptions({
    queryKey: queryKeys.schema.definitions(category),
    queryFn: () => definitionApi(category).list(),
    meta: silent,
  });

export const useDefinitions = (category: DefinitionCategory) => useQuery(definitionsQueryOptions(category));

/** Models and components together (relation targets, component pickers, cross-definition validation). */
export const useAllDefinitions = () => {
  const models = useDefinitions('model');
  const components = useDefinitions('component');
  const definitions = useMemo<DefinitionListItem[] | undefined>(
    () => (models.data && components.data ? [...models.data, ...components.data] : undefined),
    [models.data, components.data],
  );
  return { definitions, error: models.error ?? components.error };
};

/** One definition with its active version and any change still running for it. */
export const definitionQueryOptions = (category: DefinitionCategory, id: string) =>
  queryOptions({
    queryKey: queryKeys.schema.definition(category, id),
    queryFn: () => definitionApi(category).get(id),
    meta: silent,
  });

export const useDefinition = (category: DefinitionCategory, id: string) =>
  useQuery(definitionQueryOptions(category, id));

/** The global schema version and each definition's version, polled so other sessions' changes show up. */
export const useSchemaSummary = () =>
  useQuery({
    queryKey: queryKeys.schema.summary,
    queryFn: () => adminApi.schema.summary(),
    refetchInterval: SCHEMA_POLL_INTERVAL_MS,
    refetchOnWindowFocus: true,
    staleTime: 0,
    meta: silent,
  });

/**
 * The global schema version for the status bar: the same cache entry as `useSchemaSummary`, but without
 * its poll. It loads once, refreshes on window focus and after our own schema changes (they invalidate
 * `schema.all`), and follows the builder's 5s poll while a builder is open.
 */
export const useSchemaVersion = () =>
  useQuery({
    queryKey: queryKeys.schema.summary,
    queryFn: () => adminApi.schema.summary(),
    staleTime: SCHEMA_VERSION_STALE_MS,
    refetchOnWindowFocus: true,
    select: (summary) => summary.schemaVersion,
    meta: silent,
  });

export const useSchemaSettings = () =>
  useQuery({
    queryKey: queryKeys.schema.settings,
    queryFn: () => adminApi.schema.settings(),
    meta: silent,
  });

/** A planned change's status, polled until it activates, fails or is cancelled. */
export const useSchemaChange = (changeId: string | undefined) =>
  useQuery({
    queryKey: queryKeys.schema.change(changeId ?? ''),
    queryFn: () => adminApi.schema.change(changeId ?? ''),
    enabled: changeId !== undefined,
    refetchInterval: (query) =>
      query.state.data && FINAL_CHANGE_STATUSES.has(query.state.data.status)
        ? false
        : SCHEMA_CHANGE_POLL_INTERVAL_MS,
    staleTime: 0,
    meta: silent,
  });

export const useCreateDefinition = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['schema', 'create'],
    meta: silent,
    mutationFn: ({ category, input }: { category: DefinitionCategory; input: CreateDefinitionInput }) =>
      withCsrf(() => definitionApi(category).create(input)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.schema.all }),
  });
};

type PlanVariables = {
  category: DefinitionCategory;
  id: string;
  definition: DefinitionPayload;
  expectedVersion: number;
};

/** Plan preview: classification, impact and prerequisites of the draft. Writes nothing. */
export const usePlanChange = () =>
  useMutation({
    mutationKey: ['schema', 'plan'],
    meta: silent,
    mutationFn: ({ category, id, definition, expectedVersion }: PlanVariables) =>
      withCsrf(() => definitionApi(category).planUpdate(id, { definition, expectedVersion })),
  });

export const useDeleteDefinition = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['schema', 'delete'],
    mutationFn: ({
      category,
      id,
      expectedVersion,
    }: {
      category: DefinitionCategory;
      id: string;
      expectedVersion: number;
    }) => withCsrf(() => definitionApi(category).remove(id, expectedVersion)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.schema.all }),
  });
};
