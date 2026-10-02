import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useSetup, useSetupStatus } from '@/api/auth';
import { settle } from '@/helpers/settle';
import { emailField, newPasswordField, requiredText, withPasswordConfirmation } from '@/helpers/validation';
import { useFragmentToken } from '@/hooks/useFragmentToken';

/** The token is asked for (and validated) only when the server requires it (SETUP_REQUIRE_TOKEN). */
const buildSetupSchema = (requiresToken: boolean) =>
  withPasswordConfirmation({
    token: requiresToken ? requiredText() : z.string(),
    name: requiredText(),
    email: emailField(),
    password: newPasswordField(),
  });

export type SetupValues = z.infer<ReturnType<typeof buildSetupSchema>>;

/**
 * First-run owner account. By default whoever opens Setup first creates the owner; when the server says
 * `requiresToken`, the one-time setup token from the server log is needed too.
 */
export const useSetupFormAndTokenRequirement = () => {
  const token = useFragmentToken();
  const navigate = useNavigate();
  const setup = useSetup();
  // The route guard has loaded the status before this screen renders.
  const requiresToken = useSetupStatus().data?.requiresToken ?? false;
  const schema = useMemo(() => buildSetupSchema(requiresToken), [requiresToken]);
  const form = useForm<SetupValues>({
    resolver: zodResolver(schema),
    defaultValues: { token: token ?? '', name: '', email: '', password: '', confirmPassword: '' },
  });
  const onSubmit = form.handleSubmit(async ({ token: setupToken, name, email, password }) => {
    const input = { name, email, password, ...(requiresToken ? { token: setupToken.trim() } : {}) };
    if (!(await settle(setup.mutateAsync(input))).ok) {
      return;
    }
    await navigate({ to: '/', replace: true });
  });
  return { form, onSubmit, setup, requiresToken };
};
