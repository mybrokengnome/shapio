import type { ChangeSet } from '@shapio/client';

/** Set statuses each approval step accepts (the server's rule, plan approval). */
const REQUESTABLE: ReadonlySet<string> = new Set(['open', 'failed']);
const APPROVABLE: ReadonlySet<string> = new Set(['open', 'failed', 'shipped']);

export type ApprovalPermissions = { canManageChanges: boolean; canApproveChanges: boolean };

/**
 * What the approval offers this admin on this set. `current`: approved and unchanged since, so a site that
 * requires approval lets it ship. The server checks every step again.
 */
export const approvalStateOf = (
  set: Pick<ChangeSet, 'status' | 'approval'>,
  { canManageChanges, canApproveChanges }: ApprovalPermissions,
) => {
  const { status, outdated } = set.approval;
  const current = status === 'approved' && !outdated;
  return {
    current,
    canRequest: canManageChanges && REQUESTABLE.has(set.status) && status !== 'requested' && !current,
    canApprove: canApproveChanges && APPROVABLE.has(set.status) && !current,
    canRequestChanges: canApproveChanges && REQUESTABLE.has(set.status) && status !== 'changes_requested',
    canClear: canManageChanges && APPROVABLE.has(set.status) && status !== 'none',
  };
};

export type ApprovalState = ReturnType<typeof approvalStateOf>;
