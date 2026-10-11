import { useMemo } from 'react';
import { useMe } from '@/api/auth';
import { canSeeDevelop, hasSchemaPermission } from '@/helpers/modelPermissions';
import { canSeeNetwork } from '@/helpers/sites';
import type { NavAccess } from '../navItems';

/** What the navigation may offer this admin; the server enforces every action regardless. */
export const useNavAccess = (): NavAccess & { develop: boolean; canCreateType: boolean } => {
  const { data: me } = useMe();
  return useMemo(
    () => ({
      globalPermissions: me?.globalPermissions ?? [],
      networkPermissions: me?.networkPermissions ?? [],
      schema: hasSchemaPermission(me),
      network: canSeeNetwork(me),
      develop: canSeeDevelop(me),
      canCreateType: me?.globalPermissions.includes('schema.create') ?? false,
    }),
    [me],
  );
};
