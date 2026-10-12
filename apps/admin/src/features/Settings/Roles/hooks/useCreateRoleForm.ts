import { zodResolver } from '@hookform/resolvers/zod';
import type { Role } from '@shapio/client';
import { useCallback, useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { useCreateRole } from '@/api/roles';
import { i18next } from '@/app/i18n';
import { deriveKey } from '@/helpers/deriveKey';
import { settle } from '@/helpers/settle';
import { requiredText } from '@/helpers/validation';
import { useValueFromSource } from '@/hooks/useValueFromSource';
import { ROLE_KEY_PATTERN } from '../constants';

const createRoleSchema = z.object({
  key: z.string().trim().regex(ROLE_KEY_PATTERN, 'validation.roleKey'),
  name: requiredText(),
  description: z.string().trim(),
  kind: z.enum(['admin', 'delivery']),
});

export type CreateRoleValues = z.infer<typeof createRoleSchema>;

const EMPTY: CreateRoleValues = { key: '', name: '', description: '', kind: 'admin' };

/** Creates an admin or delivery role with no permissions; the caller opens its editor next. */
export const useCreateRoleForm = (open: boolean, onCreated: (role: Role) => void) => {
  const createRole = useCreateRole();
  const form = useForm<CreateRoleValues>({ resolver: zodResolver(createRoleSchema), defaultValues: EMPTY });
  const { reset, getValues, setValue } = form;
  // The key follows the name until the user types one of their own, as a model's API ID follows its label.
  useValueFromSource(
    useWatch({ control: form.control, name: 'name' }),
    useCallback(() => getValues('key'), [getValues]),
    useCallback((key: string) => setValue('key', key, { shouldValidate: false }), [setValue]),
    deriveKey,
  );
  useEffect(() => {
    if (open) {
      reset(EMPTY);
    }
  }, [open, reset]);
  const onSubmit = form.handleSubmit(async (values) => {
    const created = await settle(createRole.mutateAsync({ ...values, permissions: [] }));
    if (!created.ok) {
      return;
    }
    toast.success(i18next.t('roles.created'));
    onCreated(created.value);
  });
  return { form, onSubmit, createRole };
};
