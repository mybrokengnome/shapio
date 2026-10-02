import type { CreateLocaleInput, UpdateLocaleInput } from '@shapio/client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi } from './client';
import { withCsrf } from './csrf';
import { queryKeys } from './queryKeys';

const silent = { silent: true } as const;

export const useLocales = () =>
  useQuery({ queryKey: queryKeys.schema.locales, queryFn: () => adminApi.locales.list(), meta: silent });

/** Locales are part of the schema snapshot: every change refreshes everything schema-derived. */
const useInvalidateSchema = () => {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.schema.all });
};

export const useCreateLocale = () => {
  const invalidate = useInvalidateSchema();
  return useMutation({
    mutationKey: ['locales', 'create'],
    meta: silent,
    mutationFn: (input: CreateLocaleInput) => withCsrf(() => adminApi.locales.create(input)),
    onSuccess: invalidate,
  });
};

export const useUpdateLocale = () => {
  const invalidate = useInvalidateSchema();
  return useMutation({
    mutationKey: ['locales', 'update'],
    meta: silent,
    mutationFn: ({ code, input }: { code: string; input: UpdateLocaleInput }) =>
      withCsrf(() => adminApi.locales.update(code, input)),
    onSuccess: invalidate,
  });
};

export const useSetDefaultLocale = () => {
  const invalidate = useInvalidateSchema();
  return useMutation({
    mutationKey: ['locales', 'setDefault'],
    meta: silent,
    mutationFn: (code: string) => withCsrf(() => adminApi.locales.setDefault(code, true)),
    onSuccess: invalidate,
  });
};

/** Without the acknowledgement, a locale holding content is refused with its content count (409). */
export const useDeleteLocale = () => {
  const invalidate = useInvalidateSchema();
  return useMutation({
    mutationKey: ['locales', 'delete'],
    meta: silent,
    mutationFn: ({ code, acknowledged }: { code: string; acknowledged: boolean }) =>
      withCsrf(() => adminApi.locales.remove(code, acknowledged)),
    onSuccess: invalidate,
  });
};
