import { zodResolver } from '@hookform/resolvers/zod';
import type { AppRole } from '@shapio/client';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { useCreateAppRole } from '@/api/appRoles';
import { i18next } from '@/app/i18n';
import { settle } from '@/helpers/settle';
import { requiredText } from '@/helpers/validation';
import { ROLE_KEY_PATTERN } from '../../constants';

const createAppRoleSchema = z.object({
  key: z.string().trim().regex(ROLE_KEY_PATTERN, 'validation.roleKey'),
  name: requiredText(),
  description: z.string().trim(),
});

export type CreateAppRoleValues = z.infer<typeof createAppRoleSchema>;

const EMPTY: CreateAppRoleValues = { key: '', name: '', description: '' };

/** Creates a custom app role with no permissions; the caller opens its permission editor next. */
export const useCreateAppRoleForm = (open: boolean, onCreated: (role: AppRole) => void) => {
  const createAppRole = useCreateAppRole();
  const form = useForm<CreateAppRoleValues>({
    resolver: zodResolver(createAppRoleSchema),
    defaultValues: EMPTY,
  });
  const { reset } = form;
  useEffect(() => {
    if (open) {
      reset(EMPTY);
    }
  }, [open, reset]);
  const onSubmit = form.handleSubmit(async (values) => {
    const created = await settle(createAppRole.mutateAsync({ ...values, permissions: [] }));
    if (!created.ok) {
      return;
    }
    toast.success(i18next.t('appRoles.created'));
    onCreated(created.value);
  });
  return { form, onSubmit, createAppRole };
};
