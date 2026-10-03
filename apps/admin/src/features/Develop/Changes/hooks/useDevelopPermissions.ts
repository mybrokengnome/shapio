import { useMe } from '@/api/auth';
import { CHANGES_MANAGE_PERMISSION, CHANGES_SHIP_PERMISSION, TOKENS_MANAGE_PERMISSION } from '../constants';

/**
 * What the signed-in admin may see on the developer pages. The UI hides what they can't; the server
 * enforces it. Permissions are compared as strings: `changes.manage` arrives with D0's client types.
 */
export const useDevelopPermissions = () => {
  const permissions: readonly string[] = useMe().data?.globalPermissions ?? [];
  return {
    canManageChanges: permissions.includes(CHANGES_MANAGE_PERMISSION),
    canShipChanges: permissions.includes(CHANGES_SHIP_PERMISSION),
    canReadUsage: permissions.includes(TOKENS_MANAGE_PERMISSION),
    canManagePublishing: permissions.includes('publishing.manage'),
    canManageWebhooks: permissions.includes('webhooks.manage'),
  };
};
