import { zodResolver } from '@hookform/resolvers/zod';
import type { AdminUser } from '@shapio/client';
import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { useUpdateUser } from '@/api/users';
import { i18next } from '@/app/i18n';
import { settle } from '@/helpers/settle';
import {
  assignmentRowsSchema,
  toAssignmentRows,
  toAssignments,
  type AssignmentsValues,
} from '../helpers/assignments';

/** An admin user's role assignments, replaced as a whole (`assignments`). */
export const useAccessForm = (
  open: boolean,
  user: AdminUser,
  ownerRoleId: string | undefined,
  onDone: () => void,
) => {
  const updateUser = useUpdateUser();
  const schema = useMemo(() => z.object({ rows: assignmentRowsSchema(ownerRoleId) }), [ownerRoleId]);
  const form = useForm<AssignmentsValues>({ resolver: zodResolver(schema), defaultValues: { rows: [] } });
  const { reset } = form;
  useEffect(() => {
    if (open) {
      reset({ rows: toAssignmentRows(user.assignments, ownerRoleId) });
    }
  }, [open, user.assignments, ownerRoleId, reset]);
  const onSubmit = form.handleSubmit(async ({ rows }) => {
    const saved = await settle(
      updateUser.mutateAsync({ id: user.id, input: { assignments: toAssignments(rows) } }),
    );
    if (!saved.ok) {
      return;
    }
    toast.success(i18next.t('users.rolesSaved'));
    onDone();
  });
  return { form, onSubmit, updateUser };
};
