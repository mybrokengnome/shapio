import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  useApproveChangeSet,
  useClearApproval,
  useRequestApproval,
  useRequestChanges,
} from '@/api/changeSets';

/**
 * The four approval writes for one set, each with its confirmation toast (plan approval). Failures come back
 * to the caller (the popover shows them inline); `clear` has no form, so its failure is a toast.
 */
export const useApprovalWrites = (setId: string) => {
  const { t } = useTranslation();
  const request = useRequestApproval();
  const approve = useApproveChangeSet();
  const requestChanges = useRequestChanges();
  const clear = useClearApproval();
  return {
    request: async (note: string) => {
      await request.mutateAsync({ id: setId, input: note ? { note } : {} });
      toast.success(t('changes.approval.requested'));
    },
    approve: async (note: string) => {
      await approve.mutateAsync({ id: setId, input: note ? { note } : {} });
      toast.success(t('changes.approval.approvedToast'));
    },
    requestChanges: async (note: string) => {
      await requestChanges.mutateAsync({ id: setId, input: { note } });
      toast.success(t('changes.approval.changesRequestedToast'));
    },
    clear: () =>
      clear.mutate(setId, {
        onSuccess: () => toast.success(t('changes.approval.cleared')),
        onError: () => toast.error(t('changes.approval.clearFailed')),
      }),
    clearing: clear.isPending,
  };
};
