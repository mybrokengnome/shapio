import type { AppRole } from '@shapio/client';
import { toast } from 'sonner';
import { useUpdateAppRole } from '@/api/appRoles';
import { i18next } from '@/app/i18n';
import { describeError } from '@/helpers/describeError';

/** Whether the role already reads every model (published content, public fields). */
export const readsAllModels = (role: AppRole) =>
  role.permissions.some(
    (permission) =>
      permission.action === 'read' && permission.modelId === null && permission.condition === null,
  );

/**
 * The one-click preset for the built-in roles: add "read on all models" (published content, public fields)
 * to the role's grants, keeping the others. Built-in roles start with nothing (brief §8: deliberate enable).
 */
export const useGrantReadAll = () => {
  const updateAppRole = useUpdateAppRole();
  const grantReadAll = (role: AppRole) =>
    updateAppRole.mutate(
      {
        id: role.id,
        input: {
          expectedVersion: role.version,
          permissions: [
            ...role.permissions.filter(
              (permission) => !(permission.action === 'read' && permission.modelId === null),
            ),
            { action: 'read', modelId: null, condition: null, fieldIds: null },
          ],
        },
      },
      {
        onSuccess: () => toast.success(i18next.t('appRoles.readAllGranted', { name: role.name })),
        // The shared mutation is silent (forms show their own errors); this button has no form.
        onError: (error) => toast.error(describeError(error)),
      },
    );
  return { grantReadAll, pendingRoleId: updateAppRole.isPending ? updateAppRole.variables?.id : undefined };
};
