import type { PlanPreview } from '@shapio/client';
import type { SchemaDefinition } from '@shapio/schema';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useSaveDraftToChangeSet } from '@/api/changeSets';
import { settle } from '@/helpers/settle';

/**
 * "Review in a change set" (plan developer-face §5): the reviewed draft goes into the newest open change
 * set (or a new one), then its review opens. The draft is saved there, so leaving the builder skips the
 * unsaved-changes guard.
 */
export const useReviewInChangeSet = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const save = useSaveDraftToChangeSet();
  const reviewInChangeSet = async (preview: PlanPreview, draft: SchemaDefinition) => {
    const { plan } = preview;
    const saved = await settle(
      save.mutateAsync({
        definitionId: plan.definitionId,
        newSetTitle: t('changes.builderSetTitle', { label: draft.label }),
        input: {
          category: plan.kind === 'component' ? 'component' : 'model',
          definition: draft,
          baseVersion: plan.fromVersion,
        },
      }),
    );
    if (saved.ok) {
      await navigate({
        to: '/changes/$changeSetId',
        params: { changeSetId: saved.value },
        ignoreBlocker: true,
      });
    }
  };
  return { reviewInChangeSet, saving: save.isPending, saveError: save.error, resetSave: save.reset };
};
