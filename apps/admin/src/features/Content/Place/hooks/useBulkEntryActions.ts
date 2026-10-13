import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { adminApi } from '@/api/client';
import { invalidateEntryLists } from '@/api/content';
import { withCsrf } from '@/api/csrf';
import { queryKeys } from '@/api/queryKeys';
import { i18next } from '@/app/i18n';
import { describeError } from '@/helpers/describeError';
import { logError } from '@/helpers/reportError';
import { expectedVersionOf, type VersionedRow } from '../helpers/expectedVersion';

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
 * Publishing sends each loaded row's draft version, so a draft saved since the list loaded fails (409);
 * rows ticked on another page are not in `rows` and publish unguarded. Each request goes to the row's own
 * kind (a type's list holds its kinds' entries); rows not loaded go to the place's type, which the API
 * resolves within the family.
 */
export const useBulkEntryActions = (modelKey: string, locale: string | null) => {
  const queryClient = useQueryClient();
  const [running, setRunning] = useState<BulkAction | null>(null);
  const run = async (
    action: BulkAction,
    ids: readonly string[],
    rows: ReadonlyArray<VersionedRow & { model?: string }> = [],
  ): Promise<string[]> => {
    setRunning(action);
    const failed: string[] = [];
    let firstError: unknown;
    const locales = locale ? { locales: [locale] } : {};
    const rowOf = (id: string) => rows.find((candidate) => candidate.id === id);
    const expectedOf = (id: string) => {
      const row = rowOf(id);
      const expectedVersion = row ? expectedVersionOf(row, locale) : undefined;
      return expectedVersion !== undefined ? { expectedVersion } : {};
    };
    const touched = new Set([modelKey]);
    for (const id of ids) {
      const key = rowOf(id)?.model ?? modelKey;
      touched.add(key);
      try {
        await withCsrf<unknown>(() =>
          action === 'delete'
            ? adminApi.content.remove(key, id)
            : action === 'publish'
              ? adminApi.content.publish(key, id, { ...locales, ...expectedOf(id) })
              : adminApi.content.unpublish(key, id, locales),
        );
      } catch (error) {
        logError(error, `bulk ${action} of ${key}/${id}`);
        failed.push(id);
        firstError ??= error;
      }
    }
    setRunning(null);
    await Promise.all([
      ...[...touched].map((key) => queryClient.invalidateQueries({ queryKey: queryKeys.content.model(key) })),
      invalidateEntryLists(queryClient, [...touched], { counts: action === 'delete' }),
    ]);
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
