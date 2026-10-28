import type { ChangeSet, ChangeSetApproval } from '@shapio/client';
import { describe, expect, it } from 'vitest';
import { approvalStateOf, ineligibleMessageOf } from './approvalState';

const WORKFLOW: ChangeSetApproval['workflow'] = {
  stages: [
    { id: 'editorial', name: 'Editorial', roleIds: [], required: 1, roleNames: [] },
    {
      id: 'legal',
      name: 'Legal',
      roleIds: ['r-legal', 'r-counsel'],
      required: 2,
      roleNames: ['Legal', 'Counsel'],
    },
  ],
  selfApproval: false,
};

const approval = (overrides: Partial<ChangeSetApproval> = {}): ChangeSetApproval => ({
  status: 'none',
  note: '',
  round: 0,
  requestedBy: null,
  requestedAt: null,
  outdated: false,
  approvedAtShip: null,
  eligible: false,
  eligibleReason: null,
  stage: null,
  workflow: null,
  signoffs: [],
  approvedBy: null,
  approvedAt: null,
  ...overrides,
});

const inReview = (overrides: Partial<ChangeSetApproval> = {}) =>
  approval({
    status: 'requested',
    round: 1,
    workflow: WORKFLOW,
    stage: { index: 1, id: 'legal', name: 'Legal', required: 2, signed: 1 },
    ...overrides,
  });

const set = (status: ChangeSet['status'], value: ChangeSetApproval = approval()) => ({
  status,
  approval: value,
});

const everyone = { canManageChanges: true, canApproveChanges: true };
const preparer = { canManageChanges: true, canApproveChanges: false };

describe('approvalStateOf (plan approval-workflows)', () => {
  it('offers asking for approval only when the site has a workflow', () => {
    expect(approvalStateOf(set('open'), preparer, true)).toMatchObject({
      current: false,
      canRequest: true,
      canApprove: false,
      canRequestChanges: false,
      approveBlockedBy: null,
      canClear: false,
    });
    expect(approvalStateOf(set('open'), preparer, false).canRequest).toBe(false);
  });

  it('lets an eligible approver approve and request changes, and anyone who prepares sets clear', () => {
    expect(approvalStateOf(set('open', inReview({ eligible: true })), everyone, true)).toMatchObject({
      canRequest: false,
      canApprove: true,
      canRequestChanges: true,
      approveBlockedBy: null,
      canClear: true,
    });
  });

  it('keeps Request changes for someone who already signed or whose review went outdated', () => {
    for (const reason of ['signed', 'outdated'] as const) {
      const state = approvalStateOf(
        set('open', inReview({ eligibleReason: reason, outdated: reason === 'outdated' })),
        everyone,
        true,
      );
      expect(state).toMatchObject({ canApprove: false, canRequestChanges: true, approveBlockedBy: reason });
    }
  });

  it('refuses both steps for the wrong role, self-approval, or a stage whose roles were deleted', () => {
    for (const reason of ['role', 'self', 'rolesDeleted'] as const) {
      const state = approvalStateOf(set('open', inReview({ eligibleReason: reason })), everyone, true);
      expect(state).toMatchObject({ canApprove: false, canRequestChanges: false, approveBlockedBy: reason });
    }
  });

  it('shows no approver steps to someone without changes.approve', () => {
    const state = approvalStateOf(set('open', inReview({ eligibleReason: 'role' })), preparer, true);
    expect(state).toMatchObject({ canApprove: false, canRequestChanges: false, approveBlockedBy: null });
  });

  it('lets an outdated review or approval be asked for again; a current approval is not', () => {
    expect(approvalStateOf(set('open', inReview({ outdated: true })), preparer, true).canRequest).toBe(true);
    expect(approvalStateOf(set('open', inReview()), preparer, true).canRequest).toBe(false);
    const outdated = approvalStateOf(
      set('open', approval({ status: 'approved', outdated: true })),
      everyone,
      true,
    );
    expect(outdated).toMatchObject({ current: false, canRequest: true });
    const current = approvalStateOf(set('open', approval({ status: 'approved' })), everyone, true);
    expect(current).toMatchObject({ current: true, canRequest: false, canApprove: false });
  });

  it('takes no sign-off on a scheduled or shipped set; a shipped set can still be cleared', () => {
    const scheduled = approvalStateOf(set('scheduled', inReview({ eligible: true })), everyone, true);
    expect(scheduled).toMatchObject({ canApprove: false, canRequestChanges: false, canRequest: false });
    expect(scheduled.canClear).toBe(false);
    const shipped = approvalStateOf(set('shipped', approval({ status: 'approved' })), everyone, true);
    expect(shipped).toMatchObject({ canApprove: false, canRequest: false, canClear: true });
  });
});

describe('ineligibleMessageOf', () => {
  it('names the roles the current stage asks for', () => {
    expect(ineligibleMessageOf('role', inReview())).toEqual({
      key: 'changes.approval.ineligible.role',
      values: { roles: ['Legal', 'Counsel'] },
    });
  });

  it('falls back to a general sentence when the stage names no role', () => {
    const editorial = inReview({
      stage: { index: 0, id: 'editorial', name: 'Editorial', required: 1, signed: 0 },
    });
    expect(ineligibleMessageOf('role', editorial)).toEqual({ key: 'changes.approval.ineligible.roleAny' });
    expect(ineligibleMessageOf('role', approval())).toEqual({ key: 'changes.approval.ineligible.roleAny' });
  });

  it('has a sentence for every other reason', () => {
    expect(ineligibleMessageOf('self', inReview()).key).toBe('changes.approval.ineligible.self');
    expect(ineligibleMessageOf('signed', inReview()).key).toBe('changes.approval.ineligible.signed');
    expect(ineligibleMessageOf('outdated', inReview()).key).toBe('changes.approval.ineligible.outdated');
    expect(ineligibleMessageOf('rolesDeleted', inReview()).key).toBe(
      'changes.approval.ineligible.rolesDeleted',
    );
  });
});
