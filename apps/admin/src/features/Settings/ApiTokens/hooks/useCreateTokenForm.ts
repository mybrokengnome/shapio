import { zodResolver } from '@hookform/resolvers/zod';
import type { CreatedApiToken } from '@shapio/client';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useCreateApiToken } from '@/api/tokens';
import { settle } from '@/helpers/settle';
import { requiredText } from '@/helpers/validation';
import { expiryToDate, TOKEN_EXPIRY_OPTIONS } from '../constants';

const createTokenSchema = z.object({
  name: requiredText(),
  roleId: z.string().min(1, 'validation.selectRole'),
  expiry: z.enum(TOKEN_EXPIRY_OPTIONS),
});

export type CreateTokenValues = z.infer<typeof createTokenSchema>;

const EMPTY: CreateTokenValues = { name: '', roleId: '', expiry: '90' };

export const useCreateTokenForm = (open: boolean, onCreated: (created: CreatedApiToken) => void) => {
  const createToken = useCreateApiToken();
  const form = useForm<CreateTokenValues>({ resolver: zodResolver(createTokenSchema), defaultValues: EMPTY });
  const { reset } = form;
  useEffect(() => {
    if (open) {
      reset(EMPTY);
    }
  }, [open, reset]);
  const onSubmit = form.handleSubmit(async ({ name, roleId, expiry }) => {
    const created = await settle(createToken.mutateAsync({ name, roleId, expiresAt: expiryToDate(expiry) }));
    if (!created.ok) {
      return;
    }
    reset(EMPTY);
    onCreated(created.value);
  });
  return { form, onSubmit, createToken };
};
