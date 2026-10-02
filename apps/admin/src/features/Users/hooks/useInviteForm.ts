import { zodResolver } from '@hookform/resolvers/zod';
import type { Invitation } from '@shapio/client';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useInviteUser } from '@/api/users';
import { settle } from '@/helpers/settle';
import { emailField } from '@/helpers/validation';

const inviteSchema = z.object({
  email: emailField(),
  roleId: z.string().min(1, 'validation.selectRole'),
});

export type InviteValues = z.infer<typeof inviteSchema>;

const EMPTY: InviteValues = { email: '', roleId: '' };

type InviteFormOptions = {
  open: boolean;
  /** Preselected role (Editor), once the roles have loaded. */
  defaultRoleId: string | undefined;
  /** Runs after the invitation is created, before the sheet closes (it stays pending meanwhile). */
  onInvited: (invitation: Invitation) => Promise<unknown>;
  onDone: () => void;
};

/** The invite sheet's form: an email and exactly one role, sent as `roleIds: [roleId]`. */
export const useInviteForm = ({ open, defaultRoleId, onInvited, onDone }: InviteFormOptions) => {
  const invite = useInviteUser();
  const form = useForm<InviteValues>({ resolver: zodResolver(inviteSchema), defaultValues: EMPTY });
  const { reset } = form;
  // Roles are already loaded by the Users screen (role names), so the default is there when the sheet opens.
  useEffect(() => {
    if (open) {
      reset({ ...EMPTY, roleId: defaultRoleId ?? '' });
    }
  }, [open, defaultRoleId, reset]);
  const onSubmit = form.handleSubmit(async ({ email, roleId }) => {
    const created = await settle(invite.mutateAsync({ email, roleIds: [roleId] }));
    if (!created.ok) {
      return;
    }
    // A failure here (the copyable link) is reported by the mutation; the invitation itself exists.
    await settle(onInvited(created.value));
    reset(EMPTY);
    onDone();
  });
  return { form, onSubmit, invite };
};
