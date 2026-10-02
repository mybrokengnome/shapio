import type { FieldUsageResponse, PrincipalUsageSummary, UsageSelection } from '@shapio/client';
import { useQueries } from '@tanstack/react-query';
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
