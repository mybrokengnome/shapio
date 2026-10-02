import type { ContentAction } from '@shapio/client';
import type { ModelDefinition } from '@shapio/schema';
import { useMe } from '@/api/auth';

/**
 * What the signed-in admin may do with this model's entries (`me.modelPermissions`), so the document
 * offers only what will work. The server checks every action again.
 */
export const useEntryPermissions = (model: ModelDefinition) => {
  const me = useMe().data;
  const actions: readonly ContentAction[] | undefined = me?.modelPermissions?.[model.id];
  // Until `me` has loaded (or from a server without per-model permissions) nothing is hidden.
  const can = (action: ContentAction) => actions === undefined || actions.includes(action);
  return {
    canCreate: can('create'),
    canUpdate: can('update'),
    canDelete: can('delete'),
    canPublish: can('publish'),
    canManageSchema: can('schemaManage'),
    // Compared as a string: `changes.manage` came with D0 and may be missing from older client types.
    canUseChangeSets:
      (me?.globalPermissions as readonly string[] | undefined)?.includes('changes.manage') ?? false,
    canSchedule: (me?.globalPermissions ?? []).includes('publishing.manage') || can('publish'),
  };
};
