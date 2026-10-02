import type { ModelDefinition } from '@shapio/schema';
import { useMe } from '@/api/auth';
import { canOnModel } from '@/helpers/modelPermissions';

/** What the signed-in admin may do in this place (the server checks every request again). */
export const usePlacePermissions = (model: ModelDefinition) => {
  const me = useMe().data;
  return {
    canCreate: canOnModel(me, model.id, 'create'),
    canUpdate: canOnModel(me, model.id, 'update'),
    canDelete: canOnModel(me, model.id, 'delete'),
    canPublish: model.draftAndPublish && canOnModel(me, model.id, 'publish'),
    /** The Structure and API tabs. */
    canManageSchema: canOnModel(me, model.id, 'schemaManage'),
  };
};
