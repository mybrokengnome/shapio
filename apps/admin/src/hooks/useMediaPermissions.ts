import { useMe } from '@/api/auth';

/** What the signed-in admin may do in the media library (the server checks again). */
export const useMediaPermissions = () => {
  const me = useMe().data;
  const permissions = me?.globalPermissions ?? [];
  return {
    canWrite: permissions.includes('media.write'),
    canManage: permissions.includes('media.manage'),
    /** Only owners may delete media that content still uses. */
    isOwner: me?.roles.some((role) => role.key === 'owner') ?? false,
  };
};
