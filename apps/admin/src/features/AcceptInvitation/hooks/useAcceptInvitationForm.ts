import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';
import { type z } from 'zod';
import { useAcceptInvitation, useInspectInvitation } from '@/api/auth';
import { settle } from '@/helpers/settle';
import { newPasswordField, requiredText, withPasswordConfirmation } from '@/helpers/validation';
import { useFragmentToken } from '@/hooks/useFragmentToken';

const acceptInvitationSchema = withPasswordConfirmation({
  name: requiredText(),
  password: newPasswordField(),
});

export type AcceptInvitationValues = z.infer<typeof acceptInvitationSchema>;

/** Consumes the single-use invitation token (`?token=`) and signs the new admin in. */
export const useAcceptInvitationForm = () => {
  const token = useFragmentToken();
  const navigate = useNavigate();
  const accept = useAcceptInvitation();
  const inspection = useInspectInvitation(token);
  const form = useForm<AcceptInvitationValues>({
    resolver: zodResolver(acceptInvitationSchema),
    defaultValues: { name: '', password: '', confirmPassword: '' },
  });
  const onSubmit = form.handleSubmit(async ({ name, password }) => {
    if (!token) {
      return;
    }
    if (!(await settle(accept.mutateAsync({ token, name, password }))).ok) {
      return;
    }
    await navigate({ to: '/', replace: true });
  });
  return { form, onSubmit, accept, inspection, hasToken: Boolean(token) };
};
