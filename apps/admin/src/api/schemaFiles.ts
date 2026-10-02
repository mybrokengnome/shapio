import type { DefinitionCategory, DefinitionPayload } from '@shapio/client';
import type { SchemaDefinition } from '@shapio/schema';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { apiClient } from './client';
import { queryKeys } from './queryKeys';

const silent = { silent: true } as const;

/** `GET /api/admin/schema/export`: what `shapio schema pull` writes (canonical definitions + lock data). */
const SCHEMA_EXPORT_PATH = '/api/admin/schema/export';

export type ExportedDefinition = { definition: SchemaDefinition; version: number; hash: string };
export type SchemaExport = { schemaVersion: number; definitions: ExportedDefinition[] };

/** Under `schema.all`, so every schema change refreshes it. */
const schemaExportKey = [...queryKeys.schema.all, 'export'] as const;

/** The instance's schema as pull writes it. Always fetched fresh: the three-way guard compares against it. */
export const schemaExportQueryOptions = queryOptions({
  queryKey: schemaExportKey,
  queryFn: () => apiClient.request<SchemaExport>(SCHEMA_EXPORT_PATH),
  staleTime: 0,
  meta: silent,
});

export const useSchemaExport = () => useQuery({ ...schemaExportQueryOptions, refetchOnWindowFocus: false });

export type SchemaDraftInput = {
  definitionId: string;
  category: DefinitionCategory;
  definition: DefinitionPayload;
  /** The active version the edit is based on; null for a new definition. */
  baseVersion: number | null;
};
