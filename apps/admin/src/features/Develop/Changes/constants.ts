import type { ApprovalStatus, ChangeSetStatus } from '@shapio/client';
import type { StatusTone } from '@/components/StatusChip';

/** D0 renamed `releases.manage` to this in the change-sets migration. */
export const CHANGES_MANAGE_PERMISSION = 'changes.manage';
/** Shipping and scheduling a ship (split from `changes.manage`, agentic plan §I). */
export const CHANGES_SHIP_PERMISSION = 'changes.ship';
/** Signing off on change sets and sending them back (plan approval-workflows). */
export const CHANGES_APPROVE_PERMISSION = 'changes.approve';
export const TOKENS_MANAGE_PERMISSION = 'tokens.manage';

type Display = { labelKey: string; tone: StatusTone };

export const CHANGE_SET_STATUS_DISPLAY = {
  open: { labelKey: 'changes.statuses.open', tone: 'neutral' },
  scheduled: { labelKey: 'changes.statuses.scheduled', tone: 'scheduled' },
  shipping: { labelKey: 'changes.statuses.shipping', tone: 'progress' },
  shipped: { labelKey: 'changes.statuses.shipped', tone: 'success' },
  failed: { labelKey: 'changes.statuses.failed', tone: 'danger' },
  discarded: { labelKey: 'changes.statuses.discarded', tone: 'muted' },
} as const satisfies Record<ChangeSetStatus, Display>;

/** Sets whose items and title can still change. */
export const EDITABLE_STATUSES: ReadonlySet<ChangeSetStatus> = new Set(['open', 'failed']);

/**
 * How an approval reads; `outdated` is a set that changed after a sign-off in this round or after it was
 * approved. `none` shows nothing.
 */
export const APPROVAL_DISPLAY = {
  requested: { labelKey: 'changes.approval.statuses.requested', tone: 'scheduled' },
  approved: { labelKey: 'changes.approval.statuses.approved', tone: 'success' },
  changes_requested: { labelKey: 'changes.approval.statuses.changesRequested', tone: 'danger' },
  outdated: { labelKey: 'changes.approval.statuses.outdated', tone: 'warning' },
} as const satisfies Record<Exclude<ApprovalStatus, 'none'> | 'outdated', Display>;
