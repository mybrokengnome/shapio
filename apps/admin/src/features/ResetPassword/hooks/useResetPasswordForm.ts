import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { type z } from 'zod';
import { useConfirmPasswordReset } from '@/api/auth';
import { settle } from '@/helpers/settle';
import { newPasswordField, withPasswordConfirmation } from '@/helpers/validation';
import { useFragmentToken } from '@/hooks/useFragmentToken';

const resetPasswordSchema = withPasswordConfirmation({ password: newPasswordField() });

export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;

/** Consumes the single-use token from the emailed link (`?token=`). */
export const useResetPasswordForm = () => {
  const token = useFragmentToken();
  const confirmReset = useConfirmPasswordReset();
  const form = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: '', confirmPassword: '' },
  });
  const onSubmit = form.handleSubmit(async ({ password }) => {
    if (token) {
      await settle(confirmReset.mutateAsync({ token, password }));
    }
  });
  return { form, onSubmit, confirmReset, hasToken: Boolean(token) };
};
