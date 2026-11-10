import type {
  FieldUsageResponse,
  PrincipalUsageSummary,
  SchemaVersionsResponse,
  UsageSelection,
} from '@shapio/client';
import { useQueries, useQuery } from '@tanstack/react-query';
import { adminApi } from './client';
import { queryKeys } from './queryKeys';

/** The window the developer pages count reads over. */
export const USAGE_DAYS = 7;

const modelUsageOptions = (modelId: string, days: number) => ({
  queryKey: queryKeys.develop.usage.model(modelId, days),
  queryFn: () => adminApi.usage.fields({ modelId, days }),
  meta: { silent: true },
});

export type PrincipalFieldRead = {
  modelId: string;
  apiKeyPath: string;
  reads: number;
  lastReadAt: string;
  selection: UsageSelection;
};

/** One reader across every model: totals, its pin and the fields it read. */
export type PrincipalUsage = PrincipalUsageSummary & { fields: PrincipalFieldRead[] };

const mergeUsage = (reports: readonly FieldUsageResponse[]): PrincipalUsage[] => {
  const byKey = new Map<string, PrincipalUsage>();
  for (const report of reports) {
    for (const summary of report.principals) {
      byKey.set(summary.principalKey, { ...summary, fields: byKey.get(summary.principalKey)?.fields ?? [] });
    }
    for (const field of report.fields) {
      for (const principal of field.principals) {
        byKey.get(principal.principalKey)?.fields.push({
          modelId: report.modelId,
          apiKeyPath: field.apiKeyPath ?? field.fieldPath,
          reads: principal.reads,
          lastReadAt: principal.lastReadAt,
          selection: principal.selection,
        });
      }
    }
  }
  return [...byKey.values()].sort((a, b) => b.requests - a.requests);
};

/**
 * Who reads what across the given models (`GET /api/admin/usage/fields` once per model, cached per model).
 * `enabled` is false without `tokens.manage`. `tracking` is false when the server counts nothing new.
 */
export const usePrincipalUsage = (modelIds: readonly string[], enabled: boolean, days: number = USAGE_DAYS) =>
  useQueries({
    queries: modelIds.map((modelId) => ({ ...modelUsageOptions(modelId, days), enabled })),
    combine: (results) => {
      const reports = results.flatMap((result) => (result.data ? [result.data] : []));
      return {
        principals: mergeUsage(reports),
        tracking: reports.every((report) => report.tracking),
        isPending: enabled && results.some((result) => result.isPending),
        error: results.find((result) => result.error)?.error ?? null,
        refetch: () => Promise.all(results.map((result) => result.refetch())),
      };
    },
  });

const NO_SCHEMA_VERSIONS: ReadonlyMap<string, number> = new Map();
const TOKEN_PRINCIPAL_PREFIX = 'token:';

/** Token ID → schema version, from `token:<id>` readers (stable, so `select` reruns only on new data). */
const tokenSchemaVersionsOf = (response: SchemaVersionsResponse): ReadonlyMap<string, number> =>
  new Map(
    response.principals.flatMap((principal) =>
      principal.principalKey.startsWith(TOKEN_PRINCIPAL_PREFIX)
        ? [[principal.principalKey.slice(TOKEN_PRINCIPAL_PREFIX.length), principal.schemaVersion] as const]
        : [],
    ),
  );

/**
 * The schema version each API token's latest delivery request named (plan schema-lenses), by token ID; a
 * token that names none is not in the map. Needs `tokens.manage`.
 */
export const useTokenSchemaVersions = () => {
  const query = useQuery({
    queryKey: queryKeys.develop.usage.schemaVersions,
    queryFn: () => adminApi.usage.schemaVersions(),
    select: tokenSchemaVersionsOf,
    meta: { silent: true },
  });
  return { schemaVersions: query.data ?? NO_SCHEMA_VERSIONS };
};
