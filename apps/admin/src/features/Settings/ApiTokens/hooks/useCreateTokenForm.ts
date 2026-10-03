import { zodResolver } from '@hookform/resolvers/zod';
import type { CreatedApiToken } from '@shapio/client';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useCreateApiToken } from '@/api/tokens';
import { settle } from '@/helpers/settle';
import { requiredText } from '@/helpers/validation';
import { expiryToDate, TOKEN_EXPIRY_OPTIONS } from '../constants';

/** `site`: the token works on this site only (the default). `network`: every site and network actions. */
export const TOKEN_SCOPES = ['site', 'network'] as const;

const createTokenSchema = z.object({
  name: requiredText(),
  roleId: z.string().min(1, 'validation.selectRole'),
  expiry: z.enum(TOKEN_EXPIRY_OPTIONS),
  scope: z.enum(TOKEN_SCOPES),
});

export type CreateTokenValues = z.infer<typeof createTokenSchema>;

const EMPTY: CreateTokenValues = { name: '', roleId: '', expiry: '90', scope: 'site' };

/**
 * `canChooseNetwork(roleId)`: whether a network token may be made with that role (the creator holds
 * `users.manage` and it is an admin role; delivery tokens always belong to a site). `network` is always sent,
 * so the server never picks the kind on its own.
 */
export const useCreateTokenForm = (
  open: boolean,
  onCreated: (created: CreatedApiToken) => void,
  canChooseNetwork: (roleId: string) => boolean,
) => {
  const createToken = useCreateApiToken();
  const form = useForm<CreateTokenValues>({ resolver: zodResolver(createTokenSchema), defaultValues: EMPTY });
  const { reset } = form;
  useEffect(() => {
    if (open) {
      reset(EMPTY);
    }
  }, [open, reset]);
  const onSubmit = form.handleSubmit(async ({ name, roleId, expiry, scope }) => {
    const network = scope === 'network' && canChooseNetwork(roleId);
    const created = await settle(
      createToken.mutateAsync({ name, roleId, expiresAt: expiryToDate(expiry), network }),
    );
    if (!created.ok) {
      return;
    }
    reset(EMPTY);
    onCreated(created.value);
  });
  return { form, onSubmit, createToken };
};
