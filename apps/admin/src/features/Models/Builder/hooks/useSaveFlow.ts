import type { Acknowledgement, DefinitionCategory, PlanPreview } from '@shapio/client';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useShipDraftNow } from '@/api/changeSets';
import { hasErrorCode } from '@/api/errors';
import { definitionQueryOptions, usePlanChange } from '@/api/schema';
import { describeError } from '@/helpers/describeError';
import { logError } from '@/helpers/reportError';
import { useDefinitionDraftStore } from '@/stores/definitionDraft';
import type { useReloadDraft } from './useReloadDraft';

type ReloadDraft = ReturnType<typeof useReloadDraft>;

export type SaveFlowState =
  { step: 'idle' } | { step: 'review'; preview: PlanPreview } | { step: 'conflict' };

const isVersionConflict = (error: unknown) => hasErrorCode(error, 'SCHEMA_VERSION_CONFLICT');

/**
 * Saving a model (brief §5, plan developer-face §5): plan the draft against the version it was based on,
 * show the impact, then ship it as a one-item change set with the acknowledgements the plan needs (or put
 * it in a change set from the review sheet). A stale version at either step shows the conflict banner;
 * changes with prerequisites ship in the background and show as the definition's pending change.
 */
export const useSaveFlow = (category: DefinitionCategory, id: string, reloadDraft: ReloadDraft) => {
  const { t } = useTranslation();
  const plan = usePlanChange();
  const queryClient = useQueryClient();
  const apply = useShipDraftNow();
  const [state, setState] = useState<SaveFlowState>({ step: 'idle' });
  /** A change this session started that is still running its prerequisites. */
  const [runningChangeId, setRunningChangeId] = useState<string | undefined>(undefined);

  const notifyFailure = (error: unknown) => {
    if (isVersionConflict(error)) {
      setState({ step: 'conflict' });
      return;
    }
    toast.error(describeError(error));
  };

  const finishSuccessfully = async () => {
    toast.success(t('models.updated'));
    try {
      // Rebase rather than replace: edits made while a change was running are kept on the new version.
      await reloadDraft('rebase');
    } catch (error) {
      logError(error, 'reloading the definition after a schema change');
      toast.error(describeError(error));
    }
  };

  const review = async () => {
    const { draft, baseVersion } = useDefinitionDraftStore.getState();
    if (!draft) {
      return;
    }
    apply.reset();
    try {
      const preview = await plan.mutateAsync({
        category,
        id,
        definition: draft,
        expectedVersion: baseVersion,
      });
      setState({ step: 'review', preview });
    } catch (error) {
      notifyFailure(error);
    }
  };

  const confirm = async (acknowledgement: Acknowledgement) => {
    const { draft, baseVersion } = useDefinitionDraftStore.getState();
    if (!draft) {
      return;
    }
    try {
      const set = await apply.mutateAsync({
        definitionId: id,
        input: { category, definition: draft, baseVersion },
        acknowledgement,
        title: t('changes.builderSetTitle', { label: draft.label }),
      });
      setState({ step: 'idle' });
      if (set.status === 'shipping') {
        // Prerequisites run first; the definition's pending change tracks them (ChangeProgress).
        const detail = await queryClient.fetchQuery(definitionQueryOptions(category, id));
        setRunningChangeId(detail.pendingChange?.id);
        toast.info(t('models.builder.changeStarted'));
      } else {
        await finishSuccessfully();
      }
    } catch (error) {
      // Anything but a stale version stays in the review sheet, which shows the error.
      if (isVersionConflict(error)) {
        setState({ step: 'conflict' });
      }
    }
  };

  /** The running change ended: reload on success; keep showing a failure until it is dismissed. */
  const onChangeFinished = async (status: string) => {
    if (status === 'activated') {
      setRunningChangeId(undefined);
      await finishSuccessfully();
    }
  };

  return {
    state,
    review,
    reviewing: plan.isPending,
    confirm,
    applying: apply.isPending,
    applyError: apply.error,
    /** Leave the review or the conflict without doing anything. */
    resetStep: () => setState({ step: 'idle' }),
    runningChangeId,
    dismissChange: () => setRunningChangeId(undefined),
    onChangeFinished,
  };
};
