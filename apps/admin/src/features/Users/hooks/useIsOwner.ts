import { useMe } from '@/api/auth';
import { SYSTEM_ADMIN_ROLE_KEYS } from '@/constants/roles';

/** Whether the signed-in admin holds the owner role (the server checks again). */
export const useIsOwner = () =>
  useMe().data?.roles.some((role) => role.key === SYSTEM_ADMIN_ROLE_KEYS.owner) ?? false;
