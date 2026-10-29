import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { approvalSettingsSchema, type ApprovalSettingsValues } from '../helpers/workflowForm';

/**
 * The approval settings form both screens share (Network → Approval, Settings → Change sets): the mode and the
 * workflow, checked against the server's limits when a workflow is chosen. Role IDs in `unknownRoleIds` (roles
 * deleted since the workflow was saved) must be unchecked before it saves.
 */
export const useApprovalSettingsForm = (
  defaultValues: ApprovalSettingsValues,
  unknownRoleIds: readonly string[],
) => {
  const resolver = useMemo(() => zodResolver(approvalSettingsSchema(unknownRoleIds)), [unknownRoleIds]);
  return useForm<ApprovalSettingsValues>({ resolver, defaultValues });
};
