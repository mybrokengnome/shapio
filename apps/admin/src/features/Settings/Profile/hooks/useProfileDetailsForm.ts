import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { useMe, useUpdateProfile } from '@/api/auth';
import { i18next } from '@/app/i18n';
import { settle } from '@/helpers/settle';
import { requiredText } from '@/helpers/validation';

const profileSchema = z.object({ name: requiredText() });

export type ProfileValues = z.infer<typeof profileSchema>;

/** The signed-in admin's display name. Email changes go through an owner (Users), not self-service. */
export const useProfileDetailsForm = () => {
  const { data: me } = useMe();
  const updateProfile = useUpdateProfile();
  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { name: me?.user.name ?? '' },
  });
  const { reset, formState } = form;
  const name = me?.user.name;
  // Follow the server's value when it changes elsewhere, unless the user is mid-edit.
  useEffect(() => {
    if (!formState.isDirty && name !== undefined) {
      reset({ name });
    }
  }, [name, reset, formState.isDirty]);
  const onSubmit = form.handleSubmit(async (values) => {
    const saved = await settle(updateProfile.mutateAsync(values));
    if (!saved.ok) {
      return;
    }
    reset({ name: saved.value.name });
    toast.success(i18next.t('profile.detailsSaved'));
  });
  return { form, onSubmit, updateProfile, email: me?.user.email ?? '' };
};
