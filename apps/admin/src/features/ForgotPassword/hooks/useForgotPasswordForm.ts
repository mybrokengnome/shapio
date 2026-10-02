import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useRequestPasswordReset } from '@/api/auth';
import { settle } from '@/helpers/settle';
import { emailField } from '@/helpers/validation';

const forgotPasswordSchema = z.object({ email: emailField() });

export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;

/** The server answers the same way whether or not the email exists, so the UI does too. */
export const useForgotPasswordForm = () => {
  const requestReset = useRequestPasswordReset();
  const form = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });
  const onSubmit = form.handleSubmit(async (values) => {
    await settle(requestReset.mutateAsync(values));
  });
  return {
    form,
    onSubmit,
    requestReset,
    sentTo: requestReset.isSuccess ? requestReset.variables.email : undefined,
  };
};
