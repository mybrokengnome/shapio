import { entryLayoutOf, type EntryLayout, type ModelDefinition } from '@shapio/schema';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useShipDraftNow } from '@/api/changeSets';
import { hasErrorCode } from '@/api/errors';
import { queryKeys } from '@/api/queryKeys';
import { definitionQueryOptions, usePlanChange } from '@/api/schema';
import { describeError } from '@/helpers/describeError';
import { logError } from '@/helpers/reportError';
import { isQuietPlan, withEntryLayout } from '../helpers/layoutSwitch';

const SWITCHED_KEYS = {
  document: 'entry.layout.switchedDocument',
  form: 'entry.layout.switchedForm',
} as const satisfies Record<EntryLayout, string>;

/** The plan asked for more than a metadata change: the drawer never ships that without a review. */
class NeedsReviewError extends Error {}

/**
 * Switches how the model's entries open (`display.layout`) from the entry's Settings, at once: loads the
 * active definition, plans the change (it must be metadata only), and ships it as a one-item change set,
 * like the builder's Ship now without the review. The toast offers Undo, which ships the previous layout
 * the same way. The schema queries refresh, so the open entry re-renders in the new layout.
 */
export const useLayoutSwitch = (model: ModelDefinition) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const plan = usePlanChange();
  const ship = useShipDraftNow();

  /** Ships `layout`; resolves with the layout it replaced. */
  const shipLayout = async (layout: EntryLayout): Promise<EntryLayout> => {
    const detail = await queryClient.fetchQuery({
      ...definitionQueryOptions('model', model.id),
      staleTime: 0,
    });
    const current = detail.definition as ModelDefinition;
    const definition = withEntryLayout(current, layout);
    const preview = await plan.mutateAsync({
      category: 'model',
      id: model.id,
      definition,
      expectedVersion: detail.version,
    });
    if (!isQuietPlan(preview.plan)) {
      throw new NeedsReviewError();
    }
    await ship.mutateAsync({
      definitionId: model.id,
      input: { category: 'model', definition, baseVersion: detail.version },
      acknowledgement: {},
      title: t('entry.layout.setTitle', { model: current.label }),
    });
    // The detail fetched above is the old version, and nothing observes it to refetch after the ship's
    // invalidation: drop it, so the builder (which starts from the cached detail) loads the new one.
    queryClient.removeQueries({ queryKey: queryKeys.schema.definition('model', model.id), exact: true });
    return entryLayoutOf(current);
  };

  const notifyFailure = (error: unknown) => {
    if (error instanceof NeedsReviewError) {
      toast.error(t('entry.layout.needsReview'));
      return;
    }
    logError(error, 'switching the entry layout');
    toast.error(describeError(error));
    if (hasErrorCode(error, 'SCHEMA_VERSION_CONFLICT')) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.schema.all });
    }
  };

  const change = async (layout: EntryLayout, undoable: boolean): Promise<void> => {
    try {
      const previous = await shipLayout(layout);
      toast.success(
        t(SWITCHED_KEYS[layout], { model: model.label }),
        undoable && previous !== layout
          ? { action: { label: t('entry.layout.undo'), onClick: () => void change(previous, false) } }
          : undefined,
      );
    } catch (error) {
      notifyFailure(error);
    }
  };

  return {
    layout: entryLayoutOf(model),
    /** Ships the layout; the toast offers Undo. Failures show as a toast. */
    change: (layout: EntryLayout) => change(layout, true),
    pending: plan.isPending || ship.isPending,
  };
};
