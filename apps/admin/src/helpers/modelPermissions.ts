import type { ContentAction, GlobalAction, MeResponse } from '@shapio/client';

type Me = Pick<MeResponse, 'globalPermissions' | 'modelPermissions'>;

/**
 * Whether the admin may perform a content action on a model, from `me.modelPermissions`. The server
 * enforces every action anyway; this only decides what the navigation and the palette offer.
 */
export const canOnModel = (me: Me | null | undefined, modelId: string, action: ContentAction): boolean => {
  if (!me) {
    return false;
  }
  return me.modelPermissions[modelId]?.includes(action) ?? false;
};

/** Any schema permission: creating models, or managing the structure of at least one. */
export const hasSchemaPermission = (me: Me | null | undefined): boolean => {
  if (!me) {
    return false;
  }
  if (me.globalPermissions.includes('schema.create')) {
    return true;
  }
  return Object.values(me.modelPermissions).some((actions) => actions.includes('schemaManage'));
};

/** Developer areas show with tokens or webhooks management, or any schema permission (plan §9). */
const DEVELOP_PERMISSIONS: readonly GlobalAction[] = ['tokens.manage', 'webhooks.manage'];

export const canSeeDevelop = (me: Me | null | undefined): boolean =>
  Boolean(me) &&
  (DEVELOP_PERMISSIONS.some((action) => me?.globalPermissions.includes(action)) || hasSchemaPermission(me));
