import type { ModelDefinition } from '@shapio/schema';
import { useMe } from '@/api/auth';
import { useDefinitions } from '@/api/schema';
import { canOnModel } from '@/helpers/modelPermissions';
import { useSchemaScopeAccess } from '@/hooks/useSchemaScopeAccess';

/** What the signed-in admin may do in this place (the server checks every request again). */
export const usePlacePermissions = (model: ModelDefinition) => {
  const me = useMe().data;
  const { canCreateOnSite } = useSchemaScopeAccess();
  const shared = useDefinitions('model').data?.some(
    ({ definition, scope }) => definition.id === model.id && scope === 'network',
  );
  const canManageSchema = canOnModel(me, model.id, 'schemaManage');
  return {
    canCreate: canOnModel(me, model.id, 'create'),
    canUpdate: canOnModel(me, model.id, 'update'),
    canDelete: canOnModel(me, model.id, 'delete'),
    canPublish: model.draftAndPublish && canOnModel(me, model.id, 'publish'),
    canManageSchema,
    /**
     * The Structure and API tabs: for whoever manages the schema, and read-only for a site's schema admin
     * on a type shared with all sites (changing it needs a role on every site).
     */
    canSeeStructure: canManageSchema || (shared === true && canCreateOnSite),
  };
};
