import type { RequestFn } from '../request.js';
import { toQueryString } from './query.js';
import type { FieldUsageQuery, FieldUsageResponse } from './usageTypes.js';

export const USAGE_PATHS = { fields: '/api/admin/usage/fields' } as const;

/** Who reads which fields (needs `tokens.manage`). */
export const createUsageApi = (request: RequestFn) => ({
  usage: {
    fields: (query: FieldUsageQuery) =>
      request<FieldUsageResponse>(`${USAGE_PATHS.fields}${toQueryString(query)}`),
  },
});
