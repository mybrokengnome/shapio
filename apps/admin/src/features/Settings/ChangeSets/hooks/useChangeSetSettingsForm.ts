import type { ApprovalWorkflow, SiteChangeSets } from '@shapio/client';
import { toast } from 'sonner';
import { isConflict } from '@/api/errors';
import { useUpdateSiteChangeSets } from '@/api/siteChangeSets';
import { i18next } from '@/app/i18n';
import {
  toWorkflowInput,
  workflowValuesOf,
  type ApprovalSettingsValues,
} from '@/features/Approval/helpers/workflowForm';
import { useApprovalSettingsForm } from '@/features/Approval/hooks/useApprovalSettingsForm';
import { describeError } from '@/helpers/describeError';
import { settle } from '@/helpers/settle';

/** A site without a workflow of its own starts from a copy of the inherited one (new stages, new IDs). */
const startingWorkflow = (settings: SiteChangeSets): ApprovalWorkflow | null =>
  settings.workflow ?? settings.inherited;

const valuesOf = (settings: SiteChangeSets): ApprovalSettingsValues => {
  const values = workflowValuesOf(startingWorkflow(settings));
  return {
    mode: settings.mode,
    workflow: settings.workflow
      ? values
      : { ...values, stages: values.stages.map((stage) => ({ ...stage, stageId: null })) },
  };
};

/**
 * Settings → Change sets: whether the site inherits the network's approval workflow, turns approval off, or
 * keeps its own (plan approval-workflows), saved with the site version it was read at. The workflow is sent
 * only with `custom`; otherwise the stored one is kept. A conflict means someone saved meanwhile: the page
 * reads the fresh settings, so the person decides again.
 */
export const useChangeSetSettingsForm = (settings: SiteChangeSets) => {
  const update = useUpdateSiteChangeSets();
  const form = useApprovalSettingsForm(valuesOf(settings), settings.unknownRoleIds);
  const onSubmit = form.handleSubmit(async ({ mode, workflow }) => {
    const saved = await settle(
      update.mutateAsync({
        expectedVersion: settings.version,
        mode,
        ...(mode === 'custom' ? { workflow: toWorkflowInput(workflow) } : {}),
      }),
    );
    if (!saved.ok) {
      toast.error(isConflict(saved.error) ? i18next.t('approval.conflict') : describeError(saved.error));
      return;
    }
    form.reset(valuesOf(saved.value));
    toast.success(i18next.t('approval.saved'));
  });
  return { form, onSubmit, pending: update.isPending };
};
