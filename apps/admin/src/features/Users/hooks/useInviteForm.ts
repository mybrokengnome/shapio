import { zodResolver } from '@hookform/resolvers/zod';
import type { Invitation } from '@shapio/client';
import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useInviteUser } from '@/api/users';
import { settle } from '@/helpers/settle';
import { emailField } from '@/helpers/validation';
import { ALL_SITES, assignmentRowsSchema, toAssignments, type AssignmentRow } from '../helpers/assignments';

export type InviteValues = { email: string; rows: AssignmentRow[] };

const emptyValues = (roleId: string): InviteValues => ({ email: '', rows: [{ site: ALL_SITES, roleId }] });

type InviteFormOptions = {
  open: boolean;
  /** Preselected role (Editor, on all sites), once the roles have loaded. */
  defaultRoleId: string | undefined;
  ownerRoleId: string | undefined;
  /** Runs after the invitation is created, before the sheet closes (it stays pending meanwhile). */
  onInvited: (invitation: Invitation) => Promise<unknown>;
  onDone: () => void;
};

/** The invite sheet's form: an email and the invitee's role assignments (one row per site). */
export const useInviteForm = ({ open, defaultRoleId, ownerRoleId, onInvited, onDone }: InviteFormOptions) => {
  const invite = useInviteUser();
  const schema = useMemo(
    () => z.object({ email: emailField(), rows: assignmentRowsSchema(ownerRoleId) }),
    [ownerRoleId],
  );
  const form = useForm<InviteValues>({ resolver: zodResolver(schema), defaultValues: emptyValues('') });
  const { reset } = form;
  // Roles are already loaded by the Users screen (role names), so the default is there when the sheet opens.
  useEffect(() => {
    if (open) {
      reset(emptyValues(defaultRoleId ?? ''));
    }
  }, [open, defaultRoleId, reset]);
  const onSubmit = form.handleSubmit(async ({ email, rows }) => {
    const created = await settle(invite.mutateAsync({ email, assignments: toAssignments(rows) }));
    if (!created.ok) {
      return;
    }
    // A failure here (the copyable link) is reported by the mutation; the invitation itself exists.
    await settle(onInvited(created.value));
    reset(emptyValues(defaultRoleId ?? ''));
    onDone();
  });
  return { form, onSubmit, invite };
};
