import { zodResolver } from '@hookform/resolvers/zod';
import type { AdminAppUser } from '@shapio/client';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { useUpdateAppUser } from '@/api/appUsers';
import { i18next } from '@/app/i18n';
import { settle } from '@/helpers/settle';

const appUserRolesSchema = z.object({ roleIds: z.array(z.string()) });

export type AppUserRolesValues = z.infer<typeof appUserRolesSchema>;

/** Replaces an app user's custom roles (none is fine: `authenticated` always applies). */
export const useAppUserRolesForm = (open: boolean, user: AdminAppUser | undefined, onDone: () => void) => {
  const updateAppUser = useUpdateAppUser();
  const form = useForm<AppUserRolesValues>({
    resolver: zodResolver(appUserRolesSchema),
    defaultValues: { roleIds: [] },
  });
  const { reset } = form;
  useEffect(() => {
    if (open && user) {
      reset({ roleIds: user.roleIds });
    }
  }, [open, user, reset]);
  const onSubmit = form.handleSubmit(async ({ roleIds }) => {
    if (!user) {
      return;
    }
    if (!(await settle(updateAppUser.mutateAsync({ id: user.id, input: { roleIds } }))).ok) {
      return;
    }
    toast.success(i18next.t('appUsers.rolesSaved'));
    onDone();
  });
  return { form, onSubmit, updateAppUser };
};
