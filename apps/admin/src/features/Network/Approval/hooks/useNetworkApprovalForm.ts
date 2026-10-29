import type { NetworkApproval } from '@shapio/client';
import { toast } from 'sonner';
import { isConflict } from '@/api/errors';
import { useUpdateNetworkApproval } from '@/api/networkApproval';
import { i18next } from '@/app/i18n';
import { toWorkflowInput, workflowValuesOf } from '@/features/Approval/helpers/workflowForm';
import { useApprovalSettingsForm } from '@/features/Approval/hooks/useApprovalSettingsForm';
import { describeError } from '@/helpers/describeError';
import { settle } from '@/helpers/settle';

/**
 * Network → Approval: the default every site inherits, off or a workflow, saved with the version it was read
 * at. A conflict means someone saved meanwhile: the page reads the fresh default, so the person decides again.
 */
export const useNetworkApprovalForm = (approval: NetworkApproval) => {
  const update = useUpdateNetworkApproval();
  const form = useApprovalSettingsForm(
    { mode: approval.mode, workflow: workflowValuesOf(approval.workflow) },
    approval.unknownRoleIds,
  );
  const onSubmit = form.handleSubmit(async ({ mode, workflow }) => {
    const saved = await settle(
      update.mutateAsync({
        expectedVersion: approval.version,
        // The network form offers off and custom only (no inherit).
        mode: mode === 'custom' ? 'custom' : 'off',
        // Off keeps the stored workflow on the server, so switching back restores it.
        ...(mode === 'custom' ? { workflow: toWorkflowInput(workflow) } : {}),
      }),
    );
    if (!saved.ok) {
      toast.error(isConflict(saved.error) ? i18next.t('approval.conflict') : describeError(saved.error));
      return;
    }
    form.reset({
      mode: saved.value.mode,
      workflow: workflowValuesOf(saved.value.workflow),
    });
    toast.success(i18next.t('approval.saved'));
  });
  return { form, onSubmit, pending: update.isPending };
};
