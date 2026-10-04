import { useMe } from '@/api/auth';

/**
 * Where definitions can live, for this admin: `multiSite` when the instance has more than one site (scope
 * is shown only then), `canShare` when the admin may create and change definitions shared with all sites
 * (`schema.create` on every site), and `canCreateOnSite` when a role on this site grants it for the site's
 * own definitions. The server enforces each of these.
 */
export const useSchemaScopeAccess = () => {
  const me = useMe().data;
  return {
    multiSite: (me?.siteCount ?? 1) > 1,
    canShare: me?.networkPermissions.includes('schema.create') ?? false,
    canCreateOnSite: me?.sitePermissions.includes('schema.create') ?? false,
  };
};
