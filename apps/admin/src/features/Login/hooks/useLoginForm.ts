import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useLogin } from '@/api/auth';
import { safeRedirectPath } from '@/helpers/safeRedirect';
import { settle } from '@/helpers/settle';
import { emailField } from '@/helpers/validation';

const loginSchema = z.object({ email: emailField(), password: z.string().min(1, 'validation.required') });

export type LoginValues = z.infer<typeof loginSchema>;

export const useLoginForm = () => {
  const { redirect } = useSearch({ from: '/login' });
  const navigate = useNavigate();
  const login = useLogin();
  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });
  const onSubmit = form.handleSubmit(async (values) => {
    if (!(await settle(login.mutateAsync(values))).ok) {
      return;
    }
    await navigate({ href: safeRedirectPath(redirect), replace: true });
  });
  return { form, onSubmit, login };
};
