import type { ChangeSet, ChangeSetApproval } from '@shapio/client';
import { describe, expect, it } from 'vitest';
import { approvalStateOf } from './approvalState';

const approval = (overrides: Partial<ChangeSetApproval> = {}): ChangeSetApproval => ({
  status: 'none',
  note: '',
  requestedBy: null,
  requestedAt: null,
  approvedBy: null,
  approvedAt: null,
  outdated: false,
  approvedAtShip: null,
  ...overrides,
});

const set = (status: ChangeSet['status'], overrides: Partial<ChangeSetApproval> = {}) => ({
  status,
  approval: approval(overrides),
});

const everyone = { canManageChanges: true, canApproveChanges: true };
const preparer = { canManageChanges: true, canApproveChanges: false };

describe('approvalStateOf (plan approval)', () => {
  it('offers asking for approval to those who prepare sets, and approving to approvers', () => {
    expect(approvalStateOf(set('open'), preparer)).toMatchObject({
      current: false,
      canRequest: true,
      canApprove: false,
      canRequestChanges: false,
      canClear: false,
    });
    expect(approvalStateOf(set('open', { status: 'requested' }), everyone)).toMatchObject({
      canRequest: false,
      canApprove: true,
      canRequestChanges: true,
      canClear: true,
    });
  });

  it('treats an outdated approval as not current: it can be asked for and given again', () => {
    const outdated = approvalStateOf(set('open', { status: 'approved', outdated: true }), everyone);
    expect(outdated).toMatchObject({ current: false, canRequest: true, canApprove: true });
    const current = approvalStateOf(set('open', { status: 'approved' }), everyone);
    expect(current).toMatchObject({ current: true, canRequest: false, canApprove: false });
  });

  it('lets a shipped set be approved afterwards but not sent back; a scheduled set takes no step', () => {
    expect(approvalStateOf(set('shipped'), everyone)).toMatchObject({
      canApprove: true,
      canRequest: false,
      canRequestChanges: false,
    });
    expect(approvalStateOf(set('scheduled', { status: 'requested' }), everyone)).toMatchObject({
      canApprove: false,
      canRequest: false,
      canRequestChanges: false,
      canClear: false,
    });
  });
});
