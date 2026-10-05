import { SEO_COMPONENT_ID } from '@shapio/schema';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useDefinitions } from '@/api/schema';
import { seoConflictOf, useEnsureSeoComponent } from '@/api/seo';
import { describeError } from '@/helpers/describeError';
import { logError } from '@/helpers/reportError';
import { useSchemaScopeAccess } from '@/hooks/useSchemaScopeAccess';
import { useDefinitionDraftStore } from '@/stores/definitionDraft';
import { withAddedField } from '../../helpers/display';
import { createSeoField, hasSeoField } from '../../helpers/seoField';
import { labelInputIdOf } from './useNewField';

/**
 * What "SEO fields" can do for this draft:
 * - `ready`: the shared SEO component exists, the field is added at once;
 * - `enable`: it doesn't, and this admin may create it for every site (asks first);
 * - `askAdmin`: it doesn't, and only a network admin can create it;
 * - `present`: the draft already holds the SEO component;
 * - `loading`: the site's components aren't known yet.
 */
export type SeoFieldAvailability = 'ready' | 'enable' | 'askAdmin' | 'present' | 'loading';

/**
 * "Add field → SEO fields" (plan seo-fields): adds a field holding the shared SEO component to the draft,
 * creating the component first when this admin may (network `schema.create`). The field then goes through
 * the normal review like any other; nothing else is saved here except the component itself.
 */
export const useAddSeoField = () => {
  const { t } = useTranslation();
  const components = useDefinitions('component');
  const { canShare } = useSchemaScopeAccess();
  const present = useDefinitionDraftStore((state) => (state.draft ? hasSeoField(state.draft) : false));
  const update = useDefinitionDraftStore((state) => state.update);
  const select = useDefinitionDraftStore((state) => state.select);
  const ensure = useEnsureSeoComponent();

  const exists = components.data?.some((item) => item.definition.id === SEO_COMPONENT_ID);
  const availability: SeoFieldAvailability = present
    ? 'present'
    : exists === undefined
      ? 'loading'
      : exists
        ? 'ready'
        : canShare
          ? 'enable'
          : 'askAdmin';

  const add = () => {
    const { draft } = useDefinitionDraftStore.getState();
    if (!draft || hasSeoField(draft)) {
      return;
    }
    const field = createSeoField(draft);
    update((current) => withAddedField(current, field));
    select({ type: 'field', fieldId: field.id });
    requestAnimationFrame(() => {
      document.getElementById(labelInputIdOf(field.id))?.scrollIntoView({ block: 'center' });
    });
    toast.success(t('seo.builder.added'));
  };

  /** Creates the shared component, then adds the field. Failures are toasted (the conflict names the culprit). */
  const enableAndAdd = async () => {
    try {
      await ensure.mutateAsync();
    } catch (error) {
      logError(error, 'enabling the SEO component');
      const conflict = seoConflictOf(error);
      toast.error(
        conflict
          ? t('seo.builder.conflict', { label: conflict.label, apiKey: conflict.apiKey })
          : describeError(error),
      );
      return;
    }
    add();
  };

  return { availability, add, enableAndAdd, enabling: ensure.isPending };
};
