import type { RequestFn } from '../request.js';
import { toQueryString } from './query.js';
import type { FieldUsageQuery, FieldUsageResponse, SchemaVersionsResponse } from './usageTypes.js';

export const USAGE_PATHS = {
  fields: '/api/admin/usage/fields',
  schemaVersions: '/api/admin/usage/schema-versions',
} as const;

/** Who reads which fields (needs `tokens.manage`). */
export const createUsageApi = (request: RequestFn) => ({
  usage: {
    fields: (query: FieldUsageQuery) =>
      request<FieldUsageResponse>(`${USAGE_PATHS.fields}${toQueryString(query)}`),
    /** The schema version each reader of the workspace names now (plan schema-lenses). */
    schemaVersions: () => request<SchemaVersionsResponse>(USAGE_PATHS.schemaVersions),
  },
});
