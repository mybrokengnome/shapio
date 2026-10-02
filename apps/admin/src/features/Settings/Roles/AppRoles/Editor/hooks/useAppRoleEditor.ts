import { zodResolver } from '@hookform/resolvers/zod';
import type { AppRole } from '@shapio/client';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { useUpdateAppRole } from '@/api/appRoles';
import { i18next } from '@/app/i18n';
import { settle } from '@/helpers/settle';
import { requiredText } from '@/helpers/validation';
import { toMatrix, toPermissions, type PermissionMatrix } from '../../helpers/permissionMatrix';

const detailsSchema = z.object({ name: requiredText(), description: z.string().trim() });

export type AppRoleDetails = z.infer<typeof detailsSchema>;

/**
 * Editing one app role: its details (custom roles only) in a form, its permission matrix in state. Saving
 * sends only what changed, with the version the page loaded (a concurrent edit is a VERSION_CONFLICT).
 */
export const useAppRoleEditor = (role: AppRole) => {
  const updateAppRole = useUpdateAppRole();
  const form = useForm<AppRoleDetails>({
    resolver: zodResolver(detailsSchema),
    defaultValues: { name: role.name, description: role.description },
  });
  const [matrix, setMatrix] = useState<PermissionMatrix>(() => toMatrix(role.permissions));
  const initial = useMemo(
    () => JSON.stringify(toPermissions(toMatrix(role.permissions))),
    [role.permissions],
  );
  const permissions = useMemo(() => toPermissions(matrix), [matrix]);
  const permissionsDirty = JSON.stringify(permissions) !== initial;
  const detailsDirty = !role.isSystem && form.formState.isDirty;

  const onSubmit = form.handleSubmit(async (details) => {
    const saved = await settle(
      updateAppRole.mutateAsync({
        id: role.id,
        input: {
          expectedVersion: role.version,
          ...(detailsDirty ? details : {}),
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
    pending: updateAppRole.isPending,
    error: updateAppRole.error,
  };
};
