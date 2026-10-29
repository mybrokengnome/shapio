import type { Role } from '@shapio/client';
import { useMemo } from 'react';
import { useRoles } from '@/api/roles';

/**
 * The admin roles a workflow stage can name (delivery roles never sign off); undefined until they load, so a
 * stage doesn't call a role deleted while the list is still on its way.
 */
export const useAdminRoles = () => {
  const roles = useRoles();
  const adminRoles = useMemo<readonly Role[] | undefined>(
    () => roles.data?.filter((role) => role.kind === 'admin'),
    [roles.data],
  );
  return { adminRoles };
};
