import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { useChangePassword } from '@/api/auth';
import { i18next } from '@/app/i18n';
import { settle } from '@/helpers/settle';
import { newPasswordField, withPasswordConfirmation } from '@/helpers/validation';

const changePasswordSchema = withPasswordConfirmation({
  currentPassword: z.string().min(1, 'validation.required'),
  password: newPasswordField(),
});

export type ChangePasswordValues = z.infer<typeof changePasswordSchema>;

const EMPTY: ChangePasswordValues = { currentPassword: '', password: '', confirmPassword: '' };

export const useChangePasswordForm = () => {
  const changePassword = useChangePassword();
  const form = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: EMPTY,
  });
  const onSubmit = form.handleSubmit(async ({ currentPassword, password }) => {
    if (!(await settle(changePassword.mutateAsync({ currentPassword, newPassword: password }))).ok) {
      return;
    }
    form.reset(EMPTY);
    toast.success(i18next.t('profile.passwordChanged'));
  });
  return { form, onSubmit, changePassword };
};
