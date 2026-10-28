import type { ApprovalIneligibleReason, ChangeSet, ChangeSetApproval } from '@shapio/client';

/** Set statuses each approval step accepts (the server's rule, plan approval-workflows). */
const OPEN: ReadonlySet<string> = new Set(['open', 'failed']);
const CLEARABLE: ReadonlySet<string> = new Set(['open', 'failed', 'shipped']);

/** Reasons that still let the caller send the set back (they may sign at this stage, just not approve now). */
const MAY_REQUEST_CHANGES: ReadonlySet<ApprovalIneligibleReason> = new Set(['signed', 'outdated']);

export type ApprovalPermissions = { canManageChanges: boolean; canApproveChanges: boolean };

/**
 * What the approval offers this admin on this set. `hasWorkflow`: the site has an effective workflow, so sets
 * can be sent for approval and need it to ship. `current`: approved and unchanged since. `approveBlockedBy`:
 * why an approver can't approve at the current stage (shown beside a disabled Approve). The server checks
 * every step again.
 */
export const approvalStateOf = (
  set: Pick<ChangeSet, 'status' | 'approval'>,
  { canManageChanges, canApproveChanges }: ApprovalPermissions,
  hasWorkflow: boolean,
) => {
  const { status, outdated, eligible, eligibleReason } = set.approval;
  const current = status === 'approved' && !outdated;
  const open = OPEN.has(set.status);
  const inReview = canApproveChanges && open && status === 'requested';
  return {
    current,
    canRequest: canManageChanges && hasWorkflow && open && !current && (status !== 'requested' || outdated),
    canApprove: inReview && eligible,
    canRequestChanges:
      inReview && (eligible || (eligibleReason !== null && MAY_REQUEST_CHANGES.has(eligibleReason))),
    approveBlockedBy: inReview && !eligible ? eligibleReason : null,
    canClear: canManageChanges && CLEARABLE.has(set.status) && status !== 'none',
  };
};

export type ApprovalState = ReturnType<typeof approvalStateOf>;

/** A translation key with its values: why Approve is off, in the words the change set page shows. */
export type IneligibleMessage =
  | { key: 'changes.approval.ineligible.role'; values: { roles: string[] } }
  | {
      key:
        | 'changes.approval.ineligible.roleAny'
        | 'changes.approval.ineligible.self'
        | 'changes.approval.ineligible.signed'
        | 'changes.approval.ineligible.outdated'
        | 'changes.approval.ineligible.rolesDeleted';
      values?: undefined;
    };

/**
 * Why the caller may not approve now. `role` names the roles the current stage asks for (from the frozen
 * workflow); a stage that names none means the caller may not approve change sets at all.
 */
export const ineligibleMessageOf = (
  reason: ApprovalIneligibleReason,
  approval: Pick<ChangeSetApproval, 'stage' | 'workflow'>,
): IneligibleMessage => {
  switch (reason) {
    case 'role': {
      const index = approval.stage?.index;
      const roles = index === undefined ? [] : (approval.workflow?.stages[index]?.roleNames ?? []);
      return roles.length > 0
        ? { key: 'changes.approval.ineligible.role', values: { roles } }
        : { key: 'changes.approval.ineligible.roleAny' };
    }
    case 'self':
      return { key: 'changes.approval.ineligible.self' };
    case 'signed':
      return { key: 'changes.approval.ineligible.signed' };
    case 'outdated':
      return { key: 'changes.approval.ineligible.outdated' };
    case 'rolesDeleted':
      return { key: 'changes.approval.ineligible.rolesDeleted' };
  }
};
