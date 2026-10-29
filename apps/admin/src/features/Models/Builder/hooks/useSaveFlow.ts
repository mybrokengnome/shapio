import type {
  Acknowledgement,
  DefinitionCategory,
  PlanPreview,
  SchemaChangeJob,
  SchemaChangeResult,
} from '@shapio/client';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useShipDraftNow } from '@/api/changeSets';
import { hasErrorCode, schemaIssuesOf } from '@/api/errors';
import { fetchLatestDefinitionChange, usePlanChange } from '@/api/schema';
import { FINAL_CHANGE_STATUSES } from '@/constants/schema';
import { describeError } from '@/helpers/describeError';
import { logError } from '@/helpers/reportError';
import { useDefinitionDraftStore } from '@/stores/definitionDraft';
import { describeIssue } from '../../helpers/describeIssue';
import { describeRequiredGaps } from '../../helpers/describeStep';
import { missingContractIssues, type MissingContractIssue } from '../../helpers/interfaces';
import type { useReloadDraft } from './useReloadDraft';

type ReloadDraft = ReturnType<typeof useReloadDraft>;

export type SaveFlowState =
  | { step: 'idle' }
  | { step: 'review'; preview: PlanPreview }
  | { step: 'conflict' }
  /** An interface's new contract field that some members lack (plan interfaces decision 4). */
  | { step: 'missing'; issues: MissingContractIssue[] };

/** Plan refusals the builder's own validators can't see (they read content). */
const SERVER_ONLY_CODES: ReadonlySet<string> = new Set(['RELATION_VALUES_EXIST']);

const isVersionConflict = (error: unknown) => hasErrorCode(error, 'SCHEMA_VERSION_CONFLICT');

/**
 * Saving a model (brief §5, plan developer-face §5): plan the draft against the version it was based on,
 * show the impact, then ship it as a one-item change set with the acknowledgements the plan needs (or put
 * it in a change set from the review sheet). A stale version at either step shows the conflict banner;
 * changes with prerequisites ship in the background and the builder follows the change until it ends.
 */
export const useSaveFlow = (category: DefinitionCategory, id: string, reloadDraft: ReloadDraft) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const plan = usePlanChange();
  const apply = useShipDraftNow();
  const [state, setState] = useState<SaveFlowState>({ step: 'idle' });
  /** The background change this session shipped, followed until it ends (it may have ended already). */
  const [runningChangeId, setRunningChangeId] = useState<string | undefined>(undefined);

  const notifyFailure = (error: unknown) => {
    if (isVersionConflict(error)) {
      setState({ step: 'conflict' });
      return;
    }
    const issues = schemaIssuesOf(error);
    // Members that lack a contract field are refused on the members, not the interface: offer the fix.
    const missing = category === 'interface' ? missingContractIssues(issues) : [];
    if (missing.length > 0) {
      setState({ step: 'missing', issues: missing });
      return;
    }
    // Refusals only the server can find (content still relating to entries that would leave a relation's
    // targets) say why, with the server's counts and relation names as the detail.
    const contentIssue = issues.find((found) => SERVER_ONLY_CODES.has(found.code));
    if (contentIssue) {
      toast.error(describeIssue(contentIssue), { description: contentIssue.message });
      return;
    }
    toast.error(describeError(error));
  };

  /**
   * The change is live. When entries have no value for a field it made required, say how many and point to
   * the Inbox, where they're listed (the Inbox may list a different number: it lists drafts).
   */
  const notifySuccess = (result: SchemaChangeResult | null | undefined) => {
    const gaps = describeRequiredGaps(result, useDefinitionDraftStore.getState().draft);
    if (gaps.length === 0) {
      toast.success(t('models.updated'));
      return;
    }
    toast.success(t('models.progress.wentLive'), {
      description: gaps.join(' '),
      action: { label: t('common.openInbox'), onClick: () => void navigate({ to: '/' }) },
    });
  };

  const finishSuccessfully = async (result?: SchemaChangeResult | null) => {
    notifySuccess(result);
    try {
      // Rebase rather than replace: edits made while a change was running are kept on the new version.
      await reloadDraft('rebase');
    } catch (error) {
      logError(error, 'reloading the definition after a schema change');
      toast.error(describeError(error));
    }
  };

  /**
   * Prerequisites run first; ChangeProgress follows the change. It may have ended already (a quick job), so
   * it is followed in any state: a finished one reports its outcome on its first poll.
   */
  const followShippedChange = async () => {
    try {
      const change = await fetchLatestDefinitionChange(category, id);
      setRunningChangeId(change?.id);
      if (change && !FINAL_CHANGE_STATUSES.has(change.status)) {
        toast.info(t('models.builder.changeStarted'));
      }
    } catch (error) {
      logError(error, 'looking up the schema change the builder shipped');
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
        await followShippedChange();
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
  const onChangeFinished = async (change: SchemaChangeJob) => {
    if (change.status === 'activated') {
      setRunningChangeId(undefined);
      await finishSuccessfully(change.outcome);
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
