import { useMe } from '@/api/auth';

/** What the signed-in admin may change here. The UI hides what they can't; the server enforces it. */
export const usePublishingPermissions = () => {
  const permissions = useMe().data?.globalPermissions ?? [];
  return {
    permissions,
    canManageWebhooks: permissions.includes('webhooks.manage'),
    canManageDeployments: permissions.includes('deployments.manage'),
    canTriggerDeployments: permissions.includes('deployments.trigger'),
    canManagePublishing: permissions.includes('publishing.manage'),
  };
};
