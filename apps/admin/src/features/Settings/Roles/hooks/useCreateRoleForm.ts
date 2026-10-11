import { zodResolver } from '@hookform/resolvers/zod';
import type { Role } from '@shapio/client';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { useCreateRole } from '@/api/roles';
import { i18next } from '@/app/i18n';
import { settle } from '@/helpers/settle';
import { requiredText } from '@/helpers/validation';
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
  const { reset } = form;
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
