import { zodResolver } from '@hookform/resolvers/zod';
import type { ContentAction, PermissionAction, Role } from '@shapio/client';
import { useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { useUpdateRole } from '@/api/roles';
import { i18next } from '@/app/i18n';
import { settle } from '@/helpers/settle';
import { requiredText } from '@/helpers/validation';
import type { PermissionMatrix } from '../../PermissionMatrix/helpers/permissionMatrix';
import { joinGrants, splitGrants } from '../helpers/roleGrants';

const detailsSchema = z.object({
  name: requiredText(),
  description: z.string().trim(),
  actions: z.array(z.custom<PermissionAction>((value) => typeof value === 'string')),
});

export type RoleDetails = z.infer<typeof detailsSchema>;

/**
 * Editing one admin or delivery role: details and every-model checkboxes in a form, the permission matrix
 * in state. Saving sends only what changed, with the version the page loaded (a concurrent edit is a
 * VERSION_CONFLICT, not a silent overwrite). Every grant the role holds is shown somewhere, and sent back.
 */
export const useRoleEditor = (role: Role) => {
  const updateRole = useUpdateRole();
  const initial = useMemo(() => splitGrants(role.kind, role.permissions), [role.kind, role.permissions]);
  const form = useForm<RoleDetails>({
    resolver: zodResolver(detailsSchema),
    defaultValues: { name: role.name, description: role.description, actions: initial.actions },
  });
  const [matrix, setMatrix] = useState<PermissionMatrix<ContentAction>>(initial.matrix);
  const actions = useWatch({ control: form.control, name: 'actions' });
  const initialPermissions = useMemo(
    () => JSON.stringify(joinGrants(role.kind, initial)),
    [role.kind, initial],
  );
  const permissions = useMemo(
    () => joinGrants(role.kind, { matrix, actions, others: initial.others }),
    [role.kind, matrix, actions, initial.others],
  );
  const permissionsDirty = JSON.stringify(permissions) !== initialPermissions;
  const { dirtyFields } = form.formState;
  const detailsDirty = Boolean(dirtyFields.name ?? dirtyFields.description);

  const onSubmit = form.handleSubmit(async ({ name, description }) => {
    const saved = await settle(
      updateRole.mutateAsync({
        id: role.id,
        input: {
          expectedVersion: role.version,
          ...(detailsDirty ? { name, description } : {}),
          ...(permissionsDirty ? { permissions } : {}),
        },
      }),
    );
    if (saved.ok) {
      toast.success(i18next.t('roles.saved'));
    }
  });

  return {
    form,
    matrix,
    setMatrix,
    dirty: permissionsDirty || detailsDirty,
    onSubmit,
    pending: updateRole.isPending,
    error: updateRole.error,
  };
};
