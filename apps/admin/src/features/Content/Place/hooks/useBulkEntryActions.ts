import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { adminApi } from '@/api/client';
import { withCsrf } from '@/api/csrf';
import { queryKeys } from '@/api/queryKeys';
import { i18next } from '@/app/i18n';
import { describeError } from '@/helpers/describeError';
import { logError } from '@/helpers/reportError';

export type BulkAction = 'publish' | 'unpublish' | 'delete';

const SUCCESS_KEYS = {
  publish: 'place.bulk.published',
  unpublish: 'place.bulk.unpublished',
  delete: 'place.bulk.deleted',
} as const satisfies Record<BulkAction, string>;

const FAILURE_KEYS = {
  publish: 'place.bulk.publishFailed',
  unpublish: 'place.bulk.unpublishFailed',
  delete: 'place.bulk.deleteFailed',
} as const satisfies Record<BulkAction, string>;

/**
 * Publish, unpublish or delete several entries, one request each (so one failure, e.g. an entry still
 * referenced or invalid, does not stop the rest), then a summary with the first reason for any failures.
 */
export const useBulkEntryActions = (modelKey: string, locale: string | null) => {
  const queryClient = useQueryClient();
  const [running, setRunning] = useState<BulkAction | null>(null);
  const run = async (action: BulkAction, ids: readonly string[]): Promise<string[]> => {
    setRunning(action);
    const failed: string[] = [];
    let firstError: unknown;
    const locales = locale ? { locales: [locale] } : {};
    for (const id of ids) {
      try {
        await withCsrf<unknown>(() =>
          action === 'delete'
            ? adminApi.content.remove(modelKey, id)
            : action === 'publish'
              ? adminApi.content.publish(modelKey, id, locales)
              : adminApi.content.unpublish(modelKey, id, locales),
        );
      } catch (error) {
        logError(error, `bulk ${action} of ${modelKey}/${id}`);
        failed.push(id);
        firstError ??= error;
      }
    }
    setRunning(null);
    await queryClient.invalidateQueries({ queryKey: queryKeys.content.model(modelKey) });
    if (action === 'delete') {
      await queryClient.invalidateQueries({ queryKey: queryKeys.contentCounts });
    }
    const succeeded = ids.length - failed.length;
    if (succeeded > 0) {
      toast.success(i18next.t(SUCCESS_KEYS[action], { count: succeeded }));
    }
    if (failed.length > 0) {
      toast.error(
        i18next.t(FAILURE_KEYS[action], { count: failed.length, reason: describeError(firstError) }),
      );
    }
    return failed;
  };
  return { run, running };
};
