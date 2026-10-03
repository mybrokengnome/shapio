import type { NetworkAction } from '@shapio/client';
import { useMe } from '@/api/auth';

/** Whether the admin holds a network action (roles assigned on every site); the server enforces it either way. */
export const useNetworkPermission = (action: NetworkAction) =>
  useMe().data?.networkPermissions.includes(action) ?? false;
