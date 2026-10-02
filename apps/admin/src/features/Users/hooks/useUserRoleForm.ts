import { zodResolver } from '@hookform/resolvers/zod';
import type { AdminUser } from '@shapio/client';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { useUpdateUser } from '@/api/users';
import { i18next } from '@/app/i18n';
import { settle } from '@/helpers/settle';

const userRoleSchema = z.object({ roleId: z.string().min(1, 'validation.selectRole') });

export type UserRoleValues = z.infer<typeof userRoleSchema>;

/** An admin user's one role, sent as `roleIds: [roleId]`. `initialRoleId` is the role they hold now. */
export const useUserRoleForm = (
  open: boolean,
  user: AdminUser | undefined,
  initialRoleId: string,
  onDone: () => void,
) => {
  const updateUser = useUpdateUser();
  const form = useForm<UserRoleValues>({
    resolver: zodResolver(userRoleSchema),
    defaultValues: { roleId: '' },
  });
  const { reset } = form;
  useEffect(() => {
    if (open) {
      reset({ roleId: initialRoleId });
    }
  }, [open, initialRoleId, reset]);
  const onSubmit = form.handleSubmit(async ({ roleId }) => {
    if (!user) {
      return;
    }
    if (!(await settle(updateUser.mutateAsync({ id: user.id, input: { roleIds: [roleId] } }))).ok) {
      return;
    }
    toast.success(i18next.t('users.rolesSaved'));
    onDone();
  });
  return { form, onSubmit, updateUser };
};
